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
 * - `[Deploy]`（830）只声明关键词身份（展开未合入，见下）。
 * - “When one or more friendly units attack here”：attack-declared 时点（323.2 / 466.2.c / 466.2.c.3；
 *   383.4.e 攻击触发）；`here` 绑定本卡所在战场，`player/controller` 为“你”，`one or more friendly units`
 *   是触发条件而非目标（355.10.c：触发条件里的对象不是目标），故不写 TargetSpec。
 * - “give one of them +2 :rb_might: this turn”＝对触发事件里那些攻击者之一做临时 Might 修改：
 *   按契约 3.6 与 effect.buff 的边界说明，临时 Might 属于 layers 的 `continuous.might`
 *   （数值 2、期限 this-turn），只有该持续效果落地后才能执行；当前 `effects/instructions/` 下没有
 *   可注册的 continuous.might 指令原语（RIFT-9 清单 continuous 组 / RIFT-91 layers-continuous）。
 * - “When you hold here, you may return this to its owner's hand”：hold 时点（315.2.b.2 / 471.2 /
 *   473.2.b）；`choice.optional`（契约 3.9）包住被选指令；返回手牌用冻结的 `effect.zone`，目的地 "hand"
 *   在动作层映射为 `return-to-hand`，归属按对象的 owner 路由（本卡的返回目标是本卡自身，静态 IR 用契约 3.6
 *   的 `"source"` 选择器，由解释器绑定运行时引用；picks 条目是对象引用的声明位）。
 *
 * 缺口（不近似实现，故 judge-required）：
 * - `deploy` 关键词展开未合入（关键词批次 RIFT-81~88 / RIFT-91 不含 Deploy）；
 * - 临时 Might 修改（+2 Might this turn）没有已注册原语：契约 3.6 的冻结 GameAction 集合没有 Might 修改动作，
 *   effect.buff 明确把临时 Might 归 `continuous.might`（703 的 Buff 只是 +1 Might 的独立机制，不替代）；
 * - 攻击触发里“one of them”需要在触发条件收集攻击者后由控制者选择其中之一，属于触发式选择的落地
 *   （RIFT-33 scenarios-triggers / RIFT-9 condition 组）。
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
        duration: { kind: "constant", value: "this-turn" }
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
  trigger: { at: "hold", filter: { event: "hold", here: true, player: "controller" } },
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
    "缺临时 Might 修改原语：契约 3.6 的冻结 GameAction 集合没有 Might 修改动作，effect.buff 明确把" +
    "“+2 :rb_might: this turn”归 layers 的 continuous.might（RIFT-9 清单 continuous 组 / RIFT-91" +
    "layers-continuous 未合入），当前 effects/instructions/ 下没有可注册的 continuous.might 指令；" +
    "攻击触发里“one of them”还需要在触发条件下对攻击者做选择（RIFT-33 scenarios-triggers）。" +
    "另 [Deploy]（830.1.b）的关键词展开未合入（关键词批次 RIFT-81~88 / RIFT-91 不含 Deploy）。" +
    "hold 分支（choice.optional + effect.zone 返回手牌）已可执行并有测试；不近似实现。",
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
