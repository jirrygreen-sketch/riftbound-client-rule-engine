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
 * status = judge-required（缺口均不近似实现）：
 * - “from face down” 无法在触发过滤里判定：EventPattern/ObjectFilter 的公开词汇只有
 *   states（ready/exhausted/stunned/attached/face-down）与 zone，而 OBJECT_FILTER_ZONES
 *   没有 facedown-zone；card-played 时点的载荷也不携带“该牌从哪个区域打出”的来源信息，
 *   所以“从面朝下打出”没有求值路径（RIFT-84 Hidden/facedown-zone、RIFT-91 触发过滤）。
 *   IR 里用 details.fromFaceDown 声明这个缺失的载荷字段：它是合法的 EventPattern 词汇，
 *   但当前 card-played 事件没有 details，因此触发在合并管线上无法命中（fail-closed，
 *   不会把普通打出的牌误判成面朝下打出）。
 * - “if it's not your turn” 需要读取“当前回合玩家 vs 能力控制者”，IR 的 Expr/Condition
 *   没有该谓词位置（RIFT-87/90）。
 * 两条子效果本身（draw 1、discard 1）都只使用已合入原语，但都位于上述无法判定的
 * 触发/条件之下，所以整卡不能标记 executable；golden 校验结构并独立执行已合入原语。
 */
export default {
  canonicalCardId:
    "card.hash-94134bbbfa792bc74c51d8f90ca3d64c802ed0a643c32b0e50464e8b2431f37d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发条件 “when you play a card from face down” 没有可求值路径：CR 355.9.a.3 / 107.3.e 的 " +
    "Facedown Zone 不在 ObjectFilter 的 zone 词汇里（OBJECT_FILTER_ZONES 无 facedown-zone），" +
    "card-played 时点的载荷也不携带打出前的区域，无法判定该牌是否从面朝下打出（依赖 RIFT-84 的 " +
    "Hidden/facedown-zone 支持与 RIFT-91 的触发过滤消费）。效果内从句 “if it's not your turn”" +
    "（CR 304 / 383.2.b / 135.2.b.3）需要比较当前回合玩家与能力控制者，Expr/Condition 没有该谓词" +
    "位置（RIFT-87/90）。draw 1（effect.draw，414.1）与 discard 1（effect.discard，423.1）本身已合入，" +
    "但都在无法判定的触发/条件之下；整卡保持 judge-required，不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // “when you play a card from face down”：事件物体必须是你打出的、且来自
        // 面朝下区域。“由你打出”由 player 表达；面朝下来源在合并载荷里没有字段
        // （见 judgeReason），这里用 details.fromFaceDown 明确声明，宁可 fail-closed
        // 也不把普通打出的牌算作面朝下打出。
        filter: {
          event: "card-played",
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
