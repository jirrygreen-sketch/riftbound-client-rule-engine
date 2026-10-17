import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Evelynn, Consuming (rad-090-167) — Unit, 5 energy + 1 Body power, Might 5,
 * 标签 Evelynn/Champion。
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   [Ambush] (You may play me as a [Reaction] to a battlefield where you have
 *   units.)
 *   When you play a card from face down, ready me and give me +1 :rb_might:
 *   this turn.
 *
 * 规则依据（CR v1.5）：
 * - [Ambush] 是 822 的被动关键词（822.1.b：可被打到你有单位的战场，且此时具有 Reaction），
 *   以 keyword 能力声明；822.2 说明多个实例冗余。展开属关键词/合法位置管线。
 * - "When you play a card from face down"：触发条件是"你从面朝下（Facedown Zone）
 *   打出一张牌"（811.1.d）。时点仍是 card-played（359/383.4.a），但 filter 需要
 *   "该牌此前在 Facedown Zone"的事实；当前事件载荷与 ObjectSnapshot 都不暴露该事实，
 *   因此不能诚实订阅。
 * - "ready me"（416）用已合入的 effect.ready 原语（缺省即来源对象，355.10.g）；
 *   "give me +1 :rb_might: this turn" 是带 end-of-turn 期限的临时 Might 修正，
 *   由已合入的 continuous.might 指令（RIFT-258）经 appliesTo: "self" 注册
 *   （契约 3.4；effect.buff 明确只管 buff 计数器，绝不用它代替）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "ambush" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", player: "self", details: { fromFaceDown: true } }
    },
    optional: false,
    body: [
      {
        id: "evelynn-consuming.ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      },
      {
        // "give me +1 :rb_might: this turn" — 带期限的临时 Might 修正。
        // 已合入的 continuous.might 用 appliesTo: "self" 把作用对象绑定到
        // 能力来源（本单位），在 arithmetic 层加算并带 end-of-turn 期限
        // （契约 3.4 / 317.2.c）；effect.buff 只写 buff 计数器，不在此使用。
        id: "evelynn-consuming.grant-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "end-of-turn" },
          appliesTo: { kind: "constant", value: "self" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-5b3fa1b7bdd573b289980b7c8d29ec1591881a5af15025b61677a96fc3699461",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处缺口仍未合入：" +
    "(1) 「When you play a card from face down」需要「该牌此前在面朝下区域」的事实（CR v1.5 811.1.d 与 355.10.a.1 的 Facedown Zone）：" +
    "card-played 事件载荷（chain/engine.ts:444）与 ObjectSnapshot 都不暴露该特征。注册路径也拒绝该声明：" +
    "programs/filters.ts 的 translateTriggerFilter 把 details 落进残留 filter 分支后由 translateObjectFilter 抛 " +
    "ProgramBindingError「Unsupported filter field details」（实测），触发器无法注册；" +
    "即使绕过绑定层，事件匹配对 EventPattern.details 也是严格逐键比较（details 走 EventPattern 路径，" +
    "不是 matchesTriggerObject 的 ObjectFilter 路径），缺 card-played 事件的 fromFaceDown 载荷与 Facedown 事实，不能诚实订阅。" +
    "(2) [Ambush]（822）的 KeywordDef 已合入，但其展开仍是描述性静态数据：822.1.b 的合法打出位置需要 Finalize 的位置选择消费方、" +
    "Ambush 展开的 play-location-permission 是开放元数据形状（无 permission/restriction 字符串字段），" +
    "playLocations() 读不到（Finalize 的 playDestinationIsLegal 已消费 playLocations，chain/engine.ts:383）；" +
    "Reaction 许可方面 chain canAct 已读取 continuous.timing grants（actionTimings，chain/engine.ts:189），" +
    "但 Ambush 的 location 作用域 Reaction（822.1.b 条件许可）没有作用域消费方，写成无作用域 grants 会放宽成全局 Reaction。" +
    "已解决并真实执行的两段：「ready me」（effect.ready，416）与「give me +1 :rb_might: this turn」" +
    "（continuous.might + appliesTo self + end-of-turn 期限，RIFT-258/317.2.c，golden 用参考内核 + layers 引擎执行）。不近似实现。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When you play a card from face down, ready me and give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;
