import type { CardProgram } from "../../ir/index.js";

/**
 * Sunken Temple (sfd-218-221) — Battlefield, Fiora precon.
 *
 * "When you conquer here with one or more [Mighty] units, you may pay
 *  {1 energy} to draw 1. (A unit is Mighty while it has 5+ might.)"
 *
 * CR v1.5 (dated 2026-10-09, effective 2026-10-16):
 * - 170.2.a/b: Battlefields are established during setup and are not played.
 * - 190.6.a/d: "you" is the Controller of this Battlefield's ability.
 * - 383.3.a/b: the leading "you may" and following one-Energy base cost are
 *   chosen and paid when the Triggered Ability is finalized.
 * - 383.4.c.2 and 473.2.a: Conquer abilities look at the Units participating
 *   in the Score and trigger at the Battlefield that was Conquered.
 * - 472 and 473.2.c: one player can Score a Battlefield once per turn, and its
 *   Score ability cannot trigger more than once for that player that turn.
 * - 708/710: a Board Unit is Mighty when its layered current Might is at least
 *   five.
 *
 * The Radiance rulings effective 2026-10-16 contain no Sunken Temple ruling;
 * the checked Spiritforged errata contains no replacement text for this card.
 * Its printed source text therefore remains authoritative.
 *
 * Status remains judge-required because the production match does not yet
 * establish selected Battlefields in their rules zone, and the server does not
 * load Battlefield programs into its trusted registry. The card-local IR is
 * executable through the production ProgramBinding/ChainEngine/TurnFlow path.
 *
 * Layout note: the rules zone for a Battlefield is the ZoneId "board"; the
 * current setup helper creates selected Battlefields on the Chain first.
 */
export default {
  canonicalCardId: "card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "整卡仍有生产入口缺口（CR v1.5 170.2.a/b、190.6.a/d、473.2）：" +
    "(1) packages/engine-core/src/game/lifecycle.ts:368-385 的 pickBattlefields 只把选中的 Battlefield 创建在 chain，" +
    "没有在开局将它建立到 Battlefield Zone（宿主以 board 表示）；RIFT-959 已让预先位于 Board 的战场绑定生命周期，" +
    "但默认 createMatch 仍必须由测试夹具手工执行 move-zone 才能得到该状态。" +
    "(2) apps/game-server/src/room.ts:236-238 的 deckPrograms 只收集 mainDeck、championLegend、chosenChampion，" +
    "没有收集 battlefields，因此真实房间的 trusted ProgramRegistry 缺少本卡。" +
    "已闭合并另有生产路径 golden：RIFT-954 的 Score batchId/participatingUnits/图层后 Might/控制者同步、" +
    "RIFT-959 的既有 Board 战场生命周期绑定，以及本卡的 Finalize 前置 1 Energy 费用与真实 draw。" +
    "不得把单战场的生产测试结果误报为完整对局可执行。",
  sourceText:
    "When you conquer here with one or more [Mighty] units, you may pay :rb_energy_1: to draw 1. (A unit is Mighty while it has 5+ :rb_might:.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquered", here: true, player: "self" },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "conquering-mighty-units-at-this-battlefield",
            filter: { type: "unit", controller: "self", mightGte: 5, sameLocationAs: "source" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        },
        // A Score action emits one Conquer per participant. The batch identity
        // makes all those events one trigger opportunity (CR 472/473.2.c).
        once: "per-batch"
      },
      optional: true,
      body: [
        {
          id: "sunken-temple.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Choose whether to pay 1 Energy to draw 1?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "sunken-temple.pay",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { energy: 1 } } }
                },
                {
                  id: "sunken-temple.draw",
                  op: "effect.draw",
                  linkedTo: "sunken-temple.pay",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
