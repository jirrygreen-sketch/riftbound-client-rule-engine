import type { CardProgram } from "../../ir/index.js";

/**
 * Forge of the Future (ogn-212-298) — OGN Gear, 2 energy, 0 Order power,
 * no Might.
 *
 * Printed text:
 *   When you play this, play a 1 :rb_might: Recruit unit token at your base.
 *   Kill this: Recycle up to 4 cards from trashes.
 *
 * Ability 1 — "When you play this, play a 1 [M] Recruit unit token at your
 * base."
 * - 383.4.a.2 is the Play Effect: "When this is played" abilities are placed
 *   on the Chain after the Gear has been finalized and enters the board; the
 *   card-played timing point carries that event and is filtered to this card.
 * - "Play a … token" is the Limited Play Effect of 420.3 (420.3.a–c): a NEW
 *   token is created on the Chain and then played (440.2.c / 185.2.a / 350.2 /
 *   354). The merged kernel supports exactly that handoff — effect.token in
 *   `mode: "play"` performs `create-token` with `to: "chain"` and hands the new
 *   reference to the `play` action, which lands it at the requested Location.
 * - The Recruit identity is the frozen CR v1.5 187.1 definition (1 Might unit
 *   token, no abilities), matching effect.token's `recruit` entry. Its cost is
 *   not printed (185.3): the token is played with a Finalized zero-cost plan, so
 *   no invented energy is charged. "at your base" is the controller's base
 *   (440.4 / 185.2.a destination), supplied through effect.token's `locations` +
 *   `choiceId` resolution-time destination form (a single printed option is a
 *   fixed, replayable request).
 * Ability 2 — "Kill this: Recycle up to 4 cards from trashes."
 * - 377.1: the colon separates cost from effect — this is an Activated
 *   Ability whose cost is "Kill this" (429.2.a: a permanent leaving the Board
 *   for its Trash) and whose effect is the Recycle. 429.6 records the
 *   "Kill this, [cost]: [effect]" format, and the merged cost plan supports the
 *   nonstandard `kill` payment (cost/plan-values.ts), so the cost is declared as
 *   one CostSpec payment rather than an effect instruction.
 * - "Recycle up to 4 cards from trashes" is the 417.6 "Recycle X from [Zone]"
 *   form: the instructed player chooses up to X cards from the relevant zone(s)
 *   and recycles them; the cards are not targeted (417.6) and a shortfall
 *   recycles as many as possible (417.4). Two separate gaps block the merged
 *   `effect.recycle` `from` form, both judged in judgeReason rather than
 *   approximated:
 *   1. "trashes" (plural) is per-player Trash space (108.2.a) and the printed
 *      instruction carries no owner qualifier, while `from` reads one zone for
 *      one owner.
 *   2. "up to 4" permits choosing FEWER than 4 (355.13); `from` always asks for
 *      exactly `min(amount, available)` (`min: count, max: count` in
 *      cost/... effect.recycle's chooseFromZone), so it cannot express a
 *      player-chosen smaller number.
 *
 * Status: judge-required — ability 1 is fully expressible and executable, but
 * ability 2 cannot be expressed honestly:
 * - the frozen `effect.recycle` `from` form is `{ zone, owner?: "controller" |
 *   "source-owner", amount }` — one zone for one owner. "Trashes" names both
 *   players' Trash spaces (108.2.a), so a single-owner read would silently drop
 *   the other player's Trash from the offered pool; there is no merged
 *   multi-zone/multi-owner selection form, and no rule text that narrows
 *   "trashes" to the controller's own Trash (the 417.6 example is written
 *   "your trash"). The owner-agnostic reading is judged rather than
 *   approximated with a per-player loop that would re-ask the same choice and
 *   recycle up to 4 per player.
 * - separately, "up to 4" cannot be honoured by that form: it locks the choice
 *   to exactly `min(4, available)` objects and rejects any smaller answer
 *   (355.13 allows zero to the printed maximum). `effect.recycle` does not target
 *   (417.6), so that part is not the obstacle.
 * The golden tests execute the play-token half, the "kill this" cost payment,
 * and the currently supported controller-Trash recycle path for real; the
 * plural-zone and player-chosen-shortfall semantics remain documented in the
 * judgeReason until the recycle selection contract can express them.
 */
const forgeOfTheFuture = {
  canonicalCardId: "card.hash-6f281c2d37b0aff601bde72fa6b91be879ad2c992845d19dca912d60e4808343",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Kill this: Recycle up to 4 cards from trashes.」有两处无法用已合入的 effect.recycle from 形状（{ zone, owner?: controller | source-owner, amount }）表达：" +
    "(1) trashes 是复数：108.2.a 规定每名玩家各自拥有自己的 Trash，而原文没有所有者限定；from 只能读单一所有者的单一区域，" +
    "按 controller 读会静默漏掉对手 Trash 中的牌，也没有规则条目把 trashes 收窄为控制者自己的 Trash（417.6 的示例写作 your trash），" +
    "故不用逐玩家循环近似。(2) up to 4 允许少选甚至选 0（355.13），但 from 把选择锁成恰好 min(4, 可用数)（effect.recycle 的 chooseFromZone 用 min: count, max: count），" +
    "任何更小的答案都会被拒绝，因此无法表达玩家自选的更小张数。417.6 明确该选择不指定目标，这部分不是障碍。" +
   "此外 417.5 的随机落牌次序（同时回收多张到 Main Deck）仍由解释器/内核的 shuffle/choose 原语负责，尚未实现。" +
    "Kill this 费用（429.2.a / 429.6）本身可表达。第一个能力（Recruit token 的链上创建 + 打出，440.2.c/185.2.a/187.1）" +
    "只用已合入原语，已由 golden 真实执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", source: "self", player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "forge-of-the-future.play-recruit",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            locations: {
              kind: "constant",
              value: [{ type: "base", player: "controller" }]
            },
            choiceId: { kind: "constant", value: "forge-of-the-future.recruit-base" },
            linkKey: { kind: "constant", value: "recruitToken" }
          }
        }
      ]
    },
    {
      kind: "activated",
      cost: {
        kind: "activated",
        payments: [{ kind: "kill" }]
      },
      timing: "action",
      body: [
        {
          id: "forge-of-the-future.recycle-up-to-4",
          op: "effect.recycle",
          args: {
            from: {
              kind: "constant",
              value: {
                zone: "trash",
                amount: { kind: "constant", value: 4 }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play this, play a 1 :rb_might: Recruit unit token at your base.\n" +
    "Kill this: Recycle up to 4 cards from trashes."
} satisfies CardProgram;

export default forgeOfTheFuture;
