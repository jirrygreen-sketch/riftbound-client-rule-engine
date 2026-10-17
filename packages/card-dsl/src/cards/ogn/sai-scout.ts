import type { CardProgram } from "../../ir/index.js";

/**
 * Sai Scout (ogn-174-298) — Unit, Chaos (Shurima).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-174-298):
 *   [Vision] (When you play me, look at the top card of your Main Deck. You may
 *   recycle it.)
 *   You may play me to an open battlefield.
 *
 * Modeling (CR v1.5):
 * - [Vision] is declared as a keyword ability only (817); its merged expansion
 *   (effects/keywords/Vision.ts, RIFT-82) subscribes at object-enters-board
 *   and drives effect.inspect + effect.recycle, and the replayed Predict step
 *   executes against a supplied ordered top-of-deck pick (the engine-core
 *   Vision suite is green). What is still missing is the production lifecycle
 *   that supplies that ordered slice: effect.inspect's own contract requires
 *   an upstream ordered picksSpecId for scope "top" and returns
 *   negated/impossible without one.
 * - "You may play me to an open battlefield" grants an additional valid
 *   location during Playing a Card (355.2.a/355.2.b). It is modeled like the
 *   merged sfd Dauntless Vanguard precedent: a static play-location
 *   permission. The continuous.location primitive and the layers/rules
 *   playLocations query are merged (RIFT-259), but nothing registers a
 *   card-static permission into the layers (RIFT-257) and no Finalize
 *   placement consumer reads the query, so the permission itself is not
 *   executable and the card stays judge-required. "Open" means unoccupied and
 *   uncontrolled (170.11.c).
 */
export default {
  canonicalCardId: "card.hash-e036ea2d851b80d8cb04068759c6d7e06f97fbc36723f415d5823f097f14cd29",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两块依赖未合入：(1)[Vision]（817.1.b）的展开（RIFT-82）已合入并可执行 Predict——engine-core 的 Vision 用例全过，" +
    "effect.inspect + effect.recycle 在提供有序牌库顶 pick 时真实执行；但生产打出仍缺「按牌库顶顺序取 1 张」的生命周期：" +
    "effect.inspect 的 scope \"top\" 必须由上游提供有序 picksSpecId（其自身文档明确 query 不保证顺序，缺有序来源时 negated/impossible），" +
    "链的 Finalize 面只锁定 instruction.targets，没有有序区域 pick 的生命周期；(2)「You may play me to an open battlefield」需要打出位置许可的消费者：" +
    "continuous.location 原语与 layers/rules 的 playLocations 查询（RIFT-259）已合入，但没有把卡牌 static 能力注册进图层的绑定（RIFT-257），" +
    "也没有最终化侧（Make Relevant Choices，CR 355.2.a/355.2.b；open = 无单位且未控制，170.11.c）的放置消费方。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "vision" },
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
  sourceText:
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
    "You may play me to an open battlefield."
} satisfies CardProgram;
