import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Evelynn, In Control (rad-109-167) — Unit, 4 Energy + 1 Chaos power, Might 4,
 * tags Evelynn/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-109-167，逐字）：
 *   "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)
 *    When I hold, if you control a facedown card here, score 1 point."
 *
 * 规则依据（CR v1.5）：
 * - 831.1 / 831.1.d：Disarm 是攻击触发式关键词，功能上等于「当我攻击时，给此处一个
 *   敌方单位 -X [M] 直到本回合结束」；831.1.c.3 X 省略时视为 1；831.1.d.1 多个
 *   Disarm 实例合并为一次触发、数值相加（stacking: "sum"）。卡牌只声明关键字
 *   （契约 3.1 / README 第 5 节），展开归 effects/keywords/ 的 Disarm（未合入）。
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.a："When I hold…" 是 Hold Effect；时点 hold
 *   （events/timing-points.ts，ruleRefs 315.2.b.2 / 471.2 / 473.2.b），触发来源是
 *   固守时在场的本单位。
 * - 383.2.a.1：紧跟在触发条件后的「if you control a facedown card here」是**触发
 *   条件的一部分**（不是结算时才判定的效果从句），所以它写在 TriggerSpec.condition
 *   上：条件不满足时整个触发不进链；作为对照 383.2.a.1 的 Loose Cannon 例子说明
 *   不紧邻条件的 if 从句才属于效果。
 * - 194.1.c / 470.1："score 1 point" 是用效果获得点数（不是 Score a Battlefield），
 *   对应已合入的 effect.score（amount 1，默认接收者是能力控制者 190.6.d）。
 * - 107.3.a / 107.3.e / 355.9.a.3：Facedown Zone 是公开区域、里面的牌是私有信息；
 *   "a facedown card here" 指该战场 Facedown Zone 里的牌。

 * status = judge-required（README 第 2 节）。缺口如下，均不近似实现：
 * 1. [Disarm] 的 KeywordDef 已合入（RIFT-264~268 批次；effects/keywords/Disarm.ts），
 *    展开体是 continuous.might（RIFT-258）+ this-turn 期限 + here 锚点，golden 用真实解释器
 *    执行该展开体（锁定目标后注册 -1 Might 的 arithmetic 效果）。仍未合入的是产出方：
 *    attack-declared 在 docs/rules/timing-point-producers.md 里是「待后续」——
 *    combat/flow.ts 的角色事务未实现（CombatFlow 明确抛 combat-start-transaction），
 *    所以该触发永远不会被命中。
 * 2. 触发条件读不到 Facedown Zone：契约 ZoneId 没有 facedown-zone 成员
 *    （effect.stun.ts 记录了同一缺口），ObjectSnapshot 也没有「该战场上我控制的
 *    facedown 牌」这一集合；把条件写成任意 faceDown 标记会放宽语义。
 * 3. hold 时点的发射方已合入（turn/flow.ts 的 Beginning 计分任务，RIFT-124/270），
 *    但卡牌程序触发注册仍未接线（RIFT-257）：没有任何已合入路径把 CardProgram 的 triggered
 *    能力变成 TriggerRegistration，且引擎的 assertTriggerSpec 不接受本卡用来声明 self 的
 *    ObjectFilter 拼写。
 * 已按已合入原语写出的部分：hold 触发 + TriggerSpec.condition 门控 + effect.score 体，
 * golden 测试用参考内核真实执行 score 指令并验证条件求值路径。
 * 依赖：RIFT-257（卡牌程序触发/关键词注册）、combat 角色事务（attack-declared 发射）、
 * Facedown Zone 区域模型。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "disarm" },
  {
    kind: "triggered",
    trigger: {
      at: "hold",
      filter: { self: true },
      condition: {
        // 「if you control a facedown card here」= 383.2.a.1 的触发条件从句。
        // 计数目标集合是「该战场 Facedown Zone 中由本控制者控制的牌」；契约没有
        // facedown-zone 区域（见 judgeReason 第 2 点），故此处的区域名是待落地的
        // 缺口标记，不是已可执行的查询。
        kind: "compare",
        left: {
          kind: "count",
          subject: "facedown-cards-you-control-here",
          filter: {
            type: "card",
            controller: "controller",
            zone: "facedown-zone",
            sameLocationAs: "source"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    },
    optional: false,
    body: [
      {
        // 194.1.c / 470.1：用效果获得 1 点；接收者默认能力控制者（190.6.d）。
        id: "evelynn.score-one",
        op: "effect.score",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-7e71cd4d3c2627a9d36c7f7721c81b82138aba4816e45b83c1e9c58026ef9c9a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) [Disarm] 的 KeywordDef 与展开体已合入（effects/keywords/Disarm.ts：" +
    "continuous.might + this-turn 期限 + here 锚点，golden 真实执行该展开体并注册 -1 Might），" +
    "但 attack-declared 没有产出方——docs/rules/timing-point-producers.md 记为「待后续」：" +
    "combat/flow.ts 的角色事务未实现（CombatFlow 抛 combat-start-transaction），该触发永远不会命中；" +
    "(2) 「if you control a facedown card here」读不到 Facedown Zone：契约 ZoneId 没有 facedown-zone 成员" +
    "（同 effect.stun.ts 记录的缺口），也没有「该战场上我控制的 facedown 牌」集合，把条件放宽成任意 faceDown 标记会改变卡牌语义；" +
    "(3) hold 时点的发射方已合入（turn/flow.ts 的 Beginning 计分任务），但卡牌程序触发注册未接线（RIFT-257）：" +
    "没有路径把 CardProgram 的 triggered 能力变成 TriggerRegistration，引擎的 assertTriggerSpec 也不接受本卡的 self 过滤器拼写。" +
    "已写出的可执行部分：hold 触发 + TriggerSpec.condition 门控（383.2.a.1）+ effect.score 体（194.1.c/470.1，golden 真实执行）。" +
    "依赖：RIFT-257（卡牌程序触发/关键词注册）、combat 角色事务（attack-declared 发射）、Facedown Zone 区域模型。",
  abilities,
  sourceText:
    "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
    "When I hold, if you control a facedown card here, score 1 point."
} satisfies CardProgram;

