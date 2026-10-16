import type { CardProgram } from "../../ir/index.js";

/**
 * Sneaky Deckhand (ogn-176-298) — Unit, Chaos (Pirate / Bilgewater).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-176-298):
 *   You may play me to an open battlefield.
 *
 * Modeling (CR v1.5):
 * - The only ability is an additional valid play location (355.2.b). It is
 *   modeled as the static play-location permission used by the merged sfd
 *   Dauntless Vanguard precedent. The layers side has landed since the first
 *   survey: continuous.location registers permissions and layers/rules
 *   playLocations() reports them. What is still missing is the wiring on both
 *   ends — no merged module registers a card's static ability into the layer
 *   registry (only instruction resolution and keyword expansion touch
 *   addContinuous), and the Finalize/placement validator never queries
 *   playLocations. "Open" means unoccupied and uncontrolled (170.11.c).
 */
export default {
  canonicalCardId: "card.hash-66b3ff5cc86cf822bdc111bcd4693bcba033d4b02cc95a9e2daf443c8bbedd8a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「You may play me to an open battlefield」的静态许可没有接线：许可本体可由已合入的 continuous.location 表达" +
    "（layers/rules 的 playLocations 查询已合入，RIFT-259），但没有任何已合入模块把卡牌 static 能力注册进图层注册表" +
    "（唯一注册入口是结算中的 continuous.* 指令原语与关键词展开），且 Finalize/打出位置校验不读取 playLocations；" +
    "现有 play-location-permission 形状只是等待该接线的数据（open = 无单位且未控制，170.11.c；CR 355.2.a/355.2.b）。" +
    "不能近似成默认位置或用其它位置改写。依赖：卡牌 static 能力→layers 的注册路径与 Finalize 位置校验消费" +
    "（RIFT-91 后续 / RIFT-90 打出位置校验）。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "play-location-permission",
        value: {
          kind: "constant",
          value: {
            zone: "battlefield",
            battlefield: { open: true },
            appliesTo: "self"
          }
        },
        duration: "while-in-hand"
      }
    }
  ],
  sourceText: "You may play me to an open battlefield."
} satisfies CardProgram;
