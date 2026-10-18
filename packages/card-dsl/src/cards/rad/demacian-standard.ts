import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Demacian Standard (rad-156-167) — Gear, 2 Energy, 1 Body/Order power, might null,
 * Body/Order, tags Device / Jarvan IV / Signature.
 *
 * Printed text:
 *   [Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)
 *   When one or more friendly units attack here, give one of them +2 :rb_might: this turn.
 *   When you hold here, you may return this to its owner's hand.
 *
 * 规则依据（CR v1.5）：
 * - `[Deploy]`（830）只声明关键词身份；展开属 effects/keywords/Deploy.ts（已合入，RIFT-267），
 *   卡牌不自行展开（cards/README §5）。
 * - “When one or more friendly units attack here”：attack-declared 时点（323.2 / 466.2.c / 466.2.c.3；
 *   383.4.e 攻击触发）；`here` 绑定本卡所在战场，`player/controller` 为“你”，`one or more friendly units`
 *   是触发条件而非目标（355.10.c：触发条件里的对象不是目标），故不写 TargetSpec。
 * - “give one of them +2 :rb_might: this turn”＝对触发事件里那些攻击者之一做临时 Might 修改：
 *   按契约 3.6 与 effect.buff 的边界说明，临时 Might 属于 layers 的 `continuous.might`
 *   （数值 2、期限 this-turn）；该指令原语已合入（RIFT-258）并已由 golden 真实执行。
 * - “When you hold here, you may return this to its owner's hand”：hold 时点（315.2.b.2 / 471.2 /
 *   473.2.b）；`choice.optional`（契约 3.9）包住被选指令；返回手牌用冻结的 `effect.zone`，目的地 "hand"
 *   在动作层映射为 `return-to-hand`，归属按对象的 owner 路由（本卡的返回目标是本卡自身，静态 IR 用契约 3.6
 *   的 `"source"` 选择器，由解释器绑定运行时引用；picks 条目是对象引用的声明位）。
 *
 * 复核（2026-10-18 第四轮复核，逐项实测）：
 * - `continuous.might` 指令原语已合入（RIFT-258）：+2 Might this turn 走 arithmetic 层注册，
 *   选择器改为原语接受的 `objects.target` 形态，golden 有真实执行测试；
 * - `[Deploy]` 的 KeywordDef 已合入（effects/keywords/Deploy.ts），但其展开仍不可绑定：
 *   `programs/statics.ts` 的 `layerFor()` 对 `continuous.location` 抛
 *   “Static ability kind continuous.location has no layer mapping”（实测）；
 * - 缺口一：`attack-declared` / `hold` 的 here 锚点没有可求值形态（`programs/filters.ts` 的
 *   `translateTriggerFilter` 以 “Unsupported filter field here” 拒绝该键）。
 * - 缺口二：攻击触发的 body 也还不可绑定——TargetSpec 的 `sameLocationAs: "source"` 被
 *   `programs/filters.ts` 的 `translateObjectFilter` 以 “Unsupported filter field sameLocationAs”
 *   拒绝（实测；`programs/play.ts` 的 body 走的就是 `translateInstructionTargets`）。
 * - 缺口三：“one of them”需要在触发条件收集该处攻击者之后由控制者选其中之一；
 *   触发载荷里没有该处攻击者集合，Finalize 的 TargetSpec 又是按 filter 现场查询（355.9/466.2.c），
 *   会连带把“成为目标”发出去，所以不能改写为触发条件收集。
 *
 * 可执行部分：hold 分支（`choice.optional` + `effect.zone` 返回手牌）、以及攻击分支的“无合格攻击者时不生效”
 * 只保留结构；golden 用参考内核真实执行 hold 分支的接受/拒绝两条路径。
 */
const attackAbility: Ability = {
  kind: "triggered",
  trigger: {
    at: "attack-declared",
    filter: { event: "attack-declared", here: true, player: "controller" }
  },
  optional: false,
  body: [
    {
      id: "demacian-standard.give-might",
      op: "continuous.might",
      args: {
        amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "this-turn" },
          // 已合入原语接受的符号选择器形态（契约 3.6；解释器在结算期解析目标）。
          objects: {
            kind: "constant",
            value: { kind: "target", id: "demacian-standard.attacking-unit" }
          }
      },
      targets: [
        {
          id: "demacian-standard.attacking-unit",
          filter: { type: "unit", controller: "controller", sameLocationAs: "source" },
          selection: "one"
        }
      ]
    }
  ]
};

const holdAbility: Ability = {
  kind: "triggered",
  trigger: { at: "hold", filter: { event: "held", here: true, player: "controller" } },
  optional: true,
  body: [
    {
      id: "demacian-standard.hold-opt-in",
      op: "choice.optional",
      args: {
        prompt: { kind: "constant", value: "Return this to its owner's hand?" },
        body: {
          kind: "constant",
          value: [
            {
              id: "demacian-standard.return",
              op: "effect.zone",
              args: {
                pick: { kind: "constant", value: "demacian-standard.this" },
                to: { kind: "constant", value: "hand" }
              },
              picks: [
                {
                  id: "demacian-standard.this",
                  options: [{ kind: "source" }],
                  min: 1,
                  max: 1,
                  selection: "one"
                }
              ]
            }
          ]
        }
      }
    }
  ]
};

const program = {
  canonicalCardId: "card.hash-480ea79884e6f85ff72527f8deb9eb55bbcacb01a51c7d33332e8d830f2c20fe",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处当前缺口（2026-10-18 第四轮复核，均实测），不近似实现：" +
    "(1) 「when one or more friendly units attack here」/「when you hold here」的 here 锚点没有可求值形态：" +
    "programs/filters.ts 的 translateTriggerFilter 以 \"Unsupported filter field here\" 拒绝该键，" +
    "无法把触发绑定到本卡所在战场。" +
    "(2) 攻击触发的 body 也无法绑定：+2 Might 的 TargetSpec 用 sameLocationAs: \"source\" 表达 “here”，" +
    "programs/filters.ts 的 translateObjectFilter 以 \"Unsupported filter field sameLocationAs\" 拒绝该键（实测；play.ts 的 body 经 translateInstructionTargets）。" +
    "(3) 攻击触发里“one of them”需要在触发条件收集该处攻击者后由控制者选其中之一：" +
    "触发载荷不带该攻击者集合，Finalize 的 TargetSpec 按 filter 现场查询并会为每个被选对象发 became-target（355.9/466.2.c），" +
    "因此不能用现场目标选择冒充触发条件集合内的选择；815/831 类的战斗指派与身份（契约 3.8 combatRole）" +
    "也仍缺产生方（combat/flow.ts 抛 combat-start-transaction）。" +
    "(4) [Deploy] 的 KeywordDef 已合入（effects/keywords/Deploy.ts），但展开无法绑定：" +
    "programs/statics.ts 的 layerFor() 对 continuous.location 抛 \"Static ability kind continuous.location has no layer mapping\"（实测），" +
    "830.1.b 的地点限制与清理豁免进不了图层。" +
    "已合入部分：+2 Might this turn 用 continuous.might 表达并有真实执行测试；" +
    "hold 分支（choice.optional + effect.zone 返回手牌）已可执行且有接受/拒绝两条真实执行测试。",
  abilities: [
    { kind: "keyword", keyword: "deploy" },
    attackAbility,
    holdAbility
  ],
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When one or more friendly units attack here, give one of them +2 :rb_might: this turn.\n" +
    "When you hold here, you may return this to its owner's hand."
} satisfies CardProgram;

export default program;
