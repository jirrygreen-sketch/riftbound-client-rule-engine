import type { CardProgram } from "../../ir/index.js";

/**
 * Blossoming Dreamroot (rad-024-167) — Gear, 2 Energy, no Power, tag Device.
 *
 * Printed text (deck-catalog.json, rad-024-167, verbatim):
 *   [Deploy] (Play this only to a battlefield. When an opponent holds here, kill
 *   this.)
 *   When you win a combat here, draw 1.
 *
 * Rules evidence (Core Rules v1.5):
 * - 830.1 / 830.1.a / 830.1.b: Deploy is a Passive and Triggered Ability
 *   keyword present on Gear (only to a battlefield, not recalled in cleanups,
 *   killed when an opponent holds there). Declared here; the expansion belongs
 *   to the keyword registry (contract 3.7).
 * - 468.3 / 468.3.a: winning a combat is determined in Step 3 of combat (the
 *   Resolution Step) — a player has won when they held the attacker or defender
 *   designation and are the only player with units remaining at that
 *   Battlefield. The closed timing point for it is combat-result
 *   (events/timing-points.ts: payloadType combat-result, payloadFields
 *   battlefieldId/winnerId/loserId; refs 468.3.a-468.3.d). 468.3.d's No Result
 *   case is not a win.
 * - 053.3 / 190.6.d: here is the source Gear's Battlefield, and you in a
 *   permanent's abilities is its controller.
 * - 414.3: draw 1 is a single effect.draw, whose implicit drawer is the
 *   ability's controller (190.6.d).
 *
 * Status: judge-required (2026-10-17 source audit).
 * The source-Battlefield here filter is still unsupported. combat-result and
 * Deploy's hold spelling are absent from EVENT_PATTERN_TYPES (held is the
 * accepted alias), and combat/flow.ts still blocks the combat-start transaction.
 * Deploy's continuous.location static effect also has no layerFor mapping;
 * its play/create metadata needs the location consumer's normalized shape.
 * The location query, Hold emitter and non-Unit Deploy cleanup exemption are
 * already merged; they are not blanket missing dependencies. Draw is supported.
 */
const blossomingDreamroot = {
  canonicalCardId: "card.hash-4aaea9c834beaa6047e8f8dbb7f92137da63c691f1458dc1769641fd1ac8f358",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1)「win a combat here」缺 here 来源战场过滤、combat-result 的 EVENT_PATTERN_TYPES 入口及战斗结果生产事务（CR 053.3 / 468.3）；combat/flow.ts 仍以 combat-start-transaction 阻断。" +
    "(2) [Deploy] 展开的 continuous.location static 没有 programs/statics.ts.layerFor 映射，play/create/destinationRestriction 元数据还需转换成位置查询消费的形状（830.1.b）。" +
    "(3) Deploy 的 hold 触发使用 event: hold，而词表接受 held 别名；here 锚点也未消费。Hold 发射、位置查询与非单位 Deploy 清理豁免已存在，缺的是这些展开到运行期的接线。",
  abilities: [
    // 830.1：印刷的 [Deploy] 声明（展开由 effects/keywords/Deploy.ts 负责，
    // 卡牌侧接线见 judgeReason）。
    { kind: "keyword", keyword: "deploy" },
    {
      kind: "triggered",
      trigger: {
        at: "combat-result",
        // win a combat here：here 是来源战场锚点占位（见 judgeReason 第 1 点）；
        // you 是能力控制者（190.6.d）。
        filter: { event: "combat-result", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          id: "blossoming-dreamroot.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you win a combat here, draw 1."
} satisfies CardProgram;

export default blossomingDreamroot;
