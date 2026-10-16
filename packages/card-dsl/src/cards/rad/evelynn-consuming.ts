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
 *   "give me +1 :rb_might: this turn" 是带 end-of-turn 期限的临时 Might 修正
 *   （layers 的 continuous.might，契约 3.4；effect.buff 明确只管 buff 计数器）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "ambush" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { fromFaceDown: true } }
    },
    optional: false,
    body: [
      {
        id: "evelynn-consuming.ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      },
      {
        // "give me +1 :rb_might: this turn" — 带期限的临时 Might 修正，
        // 走 layers 的 continuous.might（见文件头与 judgeReason）。
        id: "evelynn-consuming.grant-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "end-of-turn" }
        },
        targets: [
          {
            id: "evelynn-consuming.self",
            filter: { type: "unit", object: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-5b3fa1b7bdd573b289980b7c8d29ec1591881a5af15025b61677a96fc3699461",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处依赖未合入：(1) 「When you play a card from face down」需要「该牌此前在面朝下区域」的事实" +
    "（CR v1.5 811.1.d 与 355.10.a.1 的 Facedown Zone），当前 card-played 事件载荷与 ObjectSnapshot" +
    "都不暴露该特征，不能诚实订阅该触发；(2) 「give me +1 :rb_might: this turn」是带 end-of-turn 期限的" +
    "临时 Might 修正，需要 layers 的 continuous.might（无已注册原语消费；RIFT-91；effect.buff 只管 buff" +
    "计数器）。(3) [Ambush]（822）尚无已合入 KeywordDef，合法打出位置与 Reaction 许可改写未落地。" +
    "「ready me」半段已用 effect.ready 表达并在 golden 测试中真实执行。依赖：RIFT-91、RIFT-89、" +
    "Ambush/Hidden 的关键词任务（RIFT-84）。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When you play a card from face down, ready me and give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;
