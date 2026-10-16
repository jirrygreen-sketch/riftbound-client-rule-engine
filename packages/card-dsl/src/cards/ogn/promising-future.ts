import type { CardProgram } from "../../ir/index.js";

/**
 * Promising Future (ogn-115-298) — Spell, 5 energy + 1 Mind power.
 *
 * Printed text:
 *   Each player looks at the top 5 cards of their Main Deck, chooses one, then
 *   recycles the rest. Starting with the next player, each player plays those
 *   cards, ignoring Energy costs. (They must still pay Power costs.)
 *
 * Status: judge-required — the whole ability line is one intermixed
 * multi-player procedure; the merged primitives cover none of its three
 * stages end to end:
 * - \"Each player looks at the top 5 cards of their Main Deck\": a private
 *   top-of-deck look. `effect.inspect` exists but its own docs block a non-zero
 *   top-N look without an upstream ordered picks collection (\"非零 top 查看须由上游
 *   提供有序 picksSpecId\"), because `ResolveContext.query` does not guarantee
 *   deck order; `zoneSlice` can read the ordered top N, but no merged
 *   instruction opcode exposes it to a look/reveal, and the inspecting set here
 *   spans every player (355.10.e's \"chosen in whole or in part by other
 *   players\" shape), which the card layer cannot declare per player.
 * - \"chooses one, then recycles the rest\": the choice is a non-target pick
 *   from the looked-at cards, and the recycle of the remainder needs 417.5's
 *   random-order placement (2+ cards recycl... to the Main Deck are placed in
 *   a random order) driven by the kernel's deterministic shuffle, which no
 *   instruction opcode performs for effect-recycles.
 * - \"Starting with the next player, each player plays those cards, ignoring
 *   Energy costs. (They must still pay Power costs.)\": playing a card from a
 *   private zone for each player in turn order needs the 420.3 Play effect
 *   with a cost override that ignores only Energy (356.1/356.2), plus a
 *   turn-order/next-player walk. `effect.play` consumes only an
 *   already-finalized cost plan and a known object; \"ignoring Energy costs\"
 *   would also have to preserve the printed Power requirement (the reminder is
 *   explicit), and no merged opcode walks players in turn order.
 *
 * The instructions below keep the printed stage order and the players' names
 * for review; nothing is approximated. Off-Line readings: \"those cards\" is
 * the card each player chose, not the ones they recycled (736's example uses
 * Promising Future's resolution to insert two Additional Turns, which
 * confirms the played cards are the chosen ones only).
 */
const promisingFuture = {
  canonicalCardId: "card.hash-d7bf59ee29e8ca9c306efe1bf2bd701f4edb154b5dea8674d4b6dc7aff35f61d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三段式多人流程均无端到端已合入原语：1）“Each player looks at the top 5 cards of their Main Deck” 需非零 top-N 私下查看，" +
    "effect.inspect 明确要求上游提供有序 picksSpecId（query 不保证牌库顺序，zoneSlice 顺序并未接入任何指令原语），且查看者是全体玩家（355.10.e 形状），" +
    "卡层无法逐玩家声明；2）“chooses one, then recycles the rest” 需从查看集合做非目标选择并把余牌按 417.5 随机顺序回收，" +
    "没有指令原语提交该回收/洗牌；3）“Starting with the next player, each player plays those cards, ignoring Energy costs” 需 420.3/420.4 的 " +
    "play 效果（仅忽略 Energy、保留印刷 Power 要求）加按回合顺序遍历玩家，effect.play 只消费已 finalize 的费用计划与已知对象，" +
    "无遍历玩家或部分忽略费用的路径（该半段以 effect.play-for-each-player 命名待合入原语，不套用 effect.play 的单一对象契约）。" +
    "依赖 RIFT-89（费用计划/忽略费用）、RIFT-90（目标与选择管线）、effect.inspect 的有序契约。不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // Stage 1: every player privately looks at the top 5 of their own
          // Main Deck. Described with the unmerged ordered top-N shape; the
          // inspecting players are all players (each their own deck).
          id: "each-player-look-top-5",
          op: "effect.inspect",
          args: {
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 5 },
            player: { kind: "constant", value: "each-player" },
            zone: { kind: "constant", value: "deck" },
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 1, max: 1 } },
            choiceId: { kind: "constant", value: "promising-future.choose-one" }
          }
        },
        {
          // Stage 2: recycle the rest of each player's looked-at cards (the
          // four not chosen). 417.5's simultaneous random-order placement is
          // kernel-owned; no merged opcode performs it for an effect.
          id: "each-player-recycle-rest",
          op: "effect.recycle",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "each-player-look-top-5",
              key: "inspected-rest"
            }
          },
          linkedTo: "each-player-look-top-5"
        },
        {
          // Stage 3: starting with the next player, each player plays the card
          // they chose, ignoring Energy costs but still paying Power. Needs the
          // cost-plan override and a turn-order walk that are not merged.
          id: "each-player-plays-chosen",
          // No merged opcode walks every player in turn order with a partial
          // cost waiver; effect.play takes one known object and an already
          // finalized cost plan, so the pending op is named explicitly
          // instead of overloading a merged schema (see judgeReason).
          op: "effect.play-for-each-player",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "each-player-look-top-5",
              key: "inspected-pick"
            },
            cost: {
              kind: "constant",
              value: {
                finalized: true,
                ignore: ["energy"],
                // The printed reminder: Power costs are still paid.
                pay: ["power"]
              }
            },
            order: { kind: "constant", value: "starting-with-next-player" }
          },
          linkedTo: "each-player-look-top-5"
        }
      ]
    }
  ],
  sourceText:
    "Each player looks at the top 5 cards of their Main Deck, chooses one, then recycles the rest. " +
    "Starting with the next player, each player plays those cards, ignoring Energy costs. (They must still pay Power costs.)"
} satisfies CardProgram;

export default promisingFuture;
