import type { CardProgram } from "../../ir/index.js";

/**
 * Agony's Embrace (rad-153-167 / rad-175-167) — Legend, Body/Chaos, tag Evelynn.
 *
 * sourceText（packages/card-data/data/deck-catalog.json rad-153-167，逐字）：
 *   "Once each turn, when you play a card from face down, draw 1. Then, if it's not
 *    your turn, discard 1."
 *
 * 规则依据（CR v1.5）：
 * - 383.1 / 383.2.a：“Once each turn, when you play a card from face down” 是触发条件；
 *   383.3.e / 383.3.e.1 规定 “once each turn” 的触发每回合只执行一次（IR 用
 *   TriggerSpec.once = "per-turn"，契约 3.2/3.5）。时点为打出：card-played
 *   （events/timing-points.ts 的 card-played，ruleRefs 359 / 383.4.a / 407）。
 * - “from face down” 指从 Facedown Zone 打出（355.9.a.3 定义 “Facedown card”；
 *   107.3.a 每个战场有一个 Facedown Zone，107.3.e 它不是 location；422.2.a 与
 *   811.1.c.3 规定从面朝下打出会开启链）。Hide 的细节属于关键词展开（RIFT-84）。
 * - “draw 1” 是 effect.draw（414.1 / 414.3），隐式施动者是能力控制者（190.6.d）。
 * - “Then, if it's not your turn, discard 1”：该 “if” 属于效果（383.2.b），在指令
 *   结算时检查（135.2.b.3 / 359.3.f.2）；“it's not your turn” 指当前回合玩家
 *   （CR 304）不是该传奇的操控者。
 *
 * status = judge-required（2026-10-17 源码复核）：
 * - card-played 已携带 fromZone、打出前 source 和 details.playedFromZone/printed；
 *   不再缺普通打出的来源记录。但 GameAction/ZoneId 尚无 Hide/Facedown Zone，
 *   也没有 fromFaceDown 生产者；不能把其他来源或打出后的 faceDown 状态当作该事实。
 * - 触发用显式 object:{} 将 details 留在事件模式中，已可完成翻译/注册；
 *   但 fromZone/played-from-zone 条件仍没有 Facedown Zone 值可消费（107.3.e / 355.9.a.3）。
 * - “if it's not your turn” 缺结算时的回合玩家比较；事件虽有 activePlayerId，
 *   默认 Condition/Expr 不能读取该字段，notYourTurn 也不是对象特征（304 / 383.2.b）。
 * Draw/Discard 的独立执行证据不覆盖这两个前提。
 */
export default {
  canonicalCardId:
    "card.hash-94134bbbfa792bc74c51d8f90ca3d64c802ed0a643c32b0e50464e8b2431f37d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) 面朝下打出（CR 107.3.e / 355.9.a.3）仍缺 Hide 动作与 facedown-zone 的 ZoneId/过滤值及生产接线；" +
    "card-played 已有 fromZone、打出前 source 和 details.playedFromZone/printed，但不产生 fromFaceDown。" +
    "details.fromFaceDown 过滤已可翻译/注册，但没有该来源事实；不能用打出后的 faceDown 状态代替。" +
    "(2)「if it's not your turn」（304 / 383.2.b）缺结算时 turnPlayer 与能力控制者的比较；默认 Condition/Expr 不读取事件 activePlayerId，notYourTurn 不是 ObjectSnapshot 特征。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // “when you play a card from face down”：事件物体必须是你打出的、且来自
        // 面朝下区域。“由你打出”由 player 表达；object:{} 使 details 按事件字段翻译，
        // 不再误交给对象过滤器。fromFaceDown 仍未生产，因此普通打出不会命中。
        filter: {
          event: "card-played",
          object: {},
          player: "self",
          details: { fromFaceDown: true }
        },
        // 383.3.e.1：“once each turn” 每回合只执行一次。
        once: "per-turn"
      },
      optional: false,
      body: [
        {
          id: "agonys-embrace.draw",
          // 414.1 / 414.3：“draw 1.”；隐式施动者是能力控制者（190.6.d）。
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "agonys-embrace.discard",
          // “Then, if it's not your turn, discard 1.”：条件从句只作用于本条指令
          // （契约 3.4 的条件作用范围）；该谓词的求值路径缺口见 judgeReason。
          condition: {
            kind: "expression",
            value: {
              kind: "object-property",
              object: "source",
              property: "notYourTurn"
            }
          },
          op: "effect.discard",
          args: {
            amount: { kind: "constant", value: 1 },
            // 423.1.a 的秘密选择需要稳定重放 id；隐式弃牌者是能力控制者。
            choiceId: { kind: "constant", value: "agonys-embrace.discard" }
          }
        }
      ]
    }
  ],
  sourceText:
    "Once each turn, when you play a card from face down, draw 1. Then, if it's not your turn, " +
    "discard 1."
} satisfies CardProgram;
