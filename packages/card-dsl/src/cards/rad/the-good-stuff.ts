import type { CardProgram } from "../../ir/index.js";

/**
 * The Good Stuff (rad-106-167) — Gear, 3 energy + 1 Body power，tags [Device]。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json rad-106-167）：
 *   "[Deploy] (Play this only to a battlefield. When an opponent holds here,
 *    kill this.)
 *    When you play this, discard 1, then draw 3.
 *    When you hold here, return this to its owner's hand."
 *
 * 规则依据（CR v1.5）：
 * - 830 / 830.1.b：印刷的 [Deploy]（关键词声明，展开缺口见 judgeReason）。
 * - 383.4.a.1："When you play this" 是 Gear 的 Play Effect，对应时点 card-played、
 *   filter 指向自身。
 * - 423 / 423.1.b / 423.4："discard 1" 是效果弃牌（不是费用），由弃牌者按 423.1.a
 *   选择手牌；手牌不足时按能弃多少弃多少。用已合入的 effect.discard。
 * - 414.3：「then draw 3」是紧随其后的独立指令（"then" 是顺序词，不是 "if you do"），
 *   不链接到弃牌结果：弃牌被否定 / 不可能时仍结算抽牌（055 能做什么做什么）。
 * - 383.4.d.1 / 315.2.b.2："When you hold here" 是 Hold Effect，对应时点 hold。
 * - 417/124（回手路由）："return this to its owner's hand" 用 effect.zone 的 hand
 *   目的地（return-to-hand），目的地按拥有者路由由内核处理；目标用符号选择器 source。
 *
 * status：judge-required。Deploy 没有 KeywordDef（830.1.b 三项改写未展开），且缺少
 * 卡牌程序 → 触发注册的接线（契约 3.5）。discard 1 / draw 3 / 回手三条指令都已合入，
 * golden 用解释器与参考内核真实执行；不据此宣称整卡可执行。
 */
export default {
  canonicalCardId: "card.hash-a3ace5aa975d32c702f9be7ba7a0dc4c7ca23449408374628a66fc6dc72cfd58",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Deploy 关键词没有 KeywordDef（CR 830.1.b：入场地点许可、非单位 Gear 不被清理召回、" +
    "对手在此固守时消灭此牌都需要展开；调研表 kw-deploy 指向的 continuous.location/" +
    "continuous.restrict 尚无消费方）。(2) 两条触发（card-played 自身、hold here）没有" +
    "卡牌程序→TriggerRegistration 的接线（RIFT-120 后续 / 协调任务，契约 3.5），" +
    "\"hold here\" 的 here 过滤还依赖固守时点的战场身份载荷。" +
    "discard 1、draw 3 与 return-to-hand 三条指令已合入并单独执行；不近似实现 Deploy 与触发接线。",
  abilities: [
    { kind: "keyword", keyword: "deploy" },
    {
      // 383.4.a.1："When you play this" → card-played（自身打出）。
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self", player: "self" } }
      },
      optional: false,
      body: [
        {
          // 423：效果弃牌 1（弃牌者缺省为能力控制者，190.6.d）。
          id: "the-good-stuff.discard-1",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          // 414.3：独立指令，不因弃牌被否定而跳过（055）。
          id: "the-good-stuff.draw-3",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 3 } }
        }
      ]
    },
    {
      // 383.4.d.1 / 315.2.b.2："When you hold here" → hold（此战场、由你固守）。
      kind: "triggered",
      trigger: {
        at: "hold",
        filter: { event: "hold", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          // "return this to its owner's hand"：effect.zone 的 hand 目的地按拥有者路由。
          id: "the-good-stuff.return-to-hand",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "the-good-stuff-self" },
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "the-good-stuff-self",
              filter: { source: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this, discard 1, then draw 3.\n" +
    "When you hold here, return this to its owner's hand."
} satisfies CardProgram;
