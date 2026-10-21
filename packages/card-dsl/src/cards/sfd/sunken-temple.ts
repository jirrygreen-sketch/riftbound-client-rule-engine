import type { CardProgram } from "../../ir/index.js";

/**
 * Sunken Temple (sfd-218-221) — Battlefield, Fiora precon.
 *
 * "When you conquer here with one or more [Mighty] units, you may pay
 *  {1 energy} to draw 1. (A unit is Mighty while it has 5+ might.)"
 *
 * CR v1.5 anchors:
 * - Source: Core Rules v1.5 published 2026-10-09 and effective 2026-10-16,
 *   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 * - Official Spiritforged errata (checked 2026-10-21):
 *   https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/
 * - Official Spiritforged rulings (checked 2026-10-21):
 *   https://playriftbound.com/en-us/news/rules-and-releases/riftbound-core-rules-spiritforged-patch-notes/
 * - 053.3 makes "here" the Battlefield itself; 383.4.c and 473.2.a trigger a
 *   Conquer Effect at the Battlefield that was Conquered.
 * - 706-710: a Board Unit is Mighty while its current Might is at least five.
 * - 383.3.a / 383.3.b and 204.1.c: the leading "you may" and the following
 *   one-Energy instruction cost are decided and paid at Finalize.
 * - The CR 472 limit is per player and Battlefield per turn; it is not simply
 *   the "472.2" some older summaries use. This card has no SFD errata/Radiance
 *   override; the official errata and rulings pages above were checked.
 *
 * Status remains judge-required. The event-level here anchor and the Mighty
 * predicate are now executable, but the production evaluation is not yet
 * equivalent to the printed condition:
 * - turn/flow.ts:153-170 emits one conquer event per participating Unit and
 *   publishes the aggregate participatingUnits only on the later score event.
 *   The battlefield's conquer registration therefore yields one instance per
 *   Mighty Unit; with two Mighty Units it permits paying and drawing twice,
 *   although 473.2.c restricts the score and this ability to one trigger per
 *   player per Battlefield per turn.
 * - Pipeline events carry raw Unit snapshots. The trigger count is evaluated
 *   by events/pipeline.ts:61-74 through the host ResolveContext, whose query
 *   reads the host snapshots rather than the layered effective Might. A 4-Might
 *   Unit with one Buff (effective 5) fails the event condition, contrary to
 *   CR 708/710. The query honors sameLocationAs and can exclude an outsider,
 *   but it has no binding from the event's frozen participatingUnits to this
 *   condition environment; the eventual fix must count that captured set
 *   (383.4.c.2). It also visits every other moving/current Unit to pay that
 *   per-trigger cost, even though the Conquer Effect only concerns the
 *   participating set.
 * - game/lifecycle.ts:374 places selected Battlefields in the Battlefield Zone,
 *   but effects/contract.ts:30 uses "board" as that zone. Battlefields are
 *   established setup objects (170.2.a/b), so a later Standard Move is not a
 *   rules-valid substitute. The current host leaves them on the Chain, and
 *   attachProgramLifecycle has no setup-establishment seam for this trigger.
 *   The IR below is exercised in isolation by moving the host to Board and
 *   attaching lifecycle; that fixture does not make full match setup complete.
 * - apps/game-server/src/room.ts:236-246 also registers only cards from the
 *   main deck, legend and champion list, so Battlefield programs are absent
 *   from even the runtime's trusted registry before setup begins.
 * No condition is widened to an arbitrary controller, location or Might.
 */
export default {
  canonicalCardId: "card.hash-c225141f743b61c67ddf269932c6bbdef739f37888f62163906faa7fa1e6dc2b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍有三项生产路径缺口（CR v1.5 383.4.c、472、473.2.c、708/710）：" +
    "(1) turn/flow.ts:153-170 按每个参战 Unit 各发一个 conquer 事件，aggregate participatingUnits 只在该循环之后放入 score 事件；" +
    "本战场能力在多名 Mighty 征服时会被收集多次，" +
    "EventPipeline 因而两次询问 Finalize。CR 472 把 Score 限制为该玩家每个 Battlefield 每回合一次，" +
    "473.2.c 又规定这些能力每玩家每回合只在该 Battlefield 被 Score 时触发一次；当前没有把该 Score/Battlefield 的身份接到触发频度，" +
    "需要由 Score 波提供稳定的“同一 Score 事件”标识。" +
    "(2) events/pipeline.ts:61-74 的触发条件通过 ResolveContext.query 读取 host 原样快照；4 Might 加 1 Buff 的有效 Might 为 5，" +
    "但时点条件实测不触发，未满足 708/710 的当前 Might；条件查询虽支持 sameLocationAs，却没有从事件 details.participatingUnits " +
    "绑定 383.4.c.2 冻结的本次参战单位集合。需要由触发求值使用图层后的不可变 event/LKI 单位快照与事件中的参战集合。" +
    "(3) game/lifecycle.ts:374 声明 Battlefield 进入 Battlefield Zone，但 effects/contract.ts:30 以 \"board\" 承载该区，" +
    "但 170.2.a/b 规定 Battlefield 在开局建立、不是常规打出的 Permanent；当前 host 因此只把选中的 Battlefield 创建在 chain 区，" +
    "attachProgramLifecycle 没有 setup-establishment seam，无法注册 190.6/473.2 的印刷触发。真实 Board move-zone + lifecycle 下事件级 here、Mighty 候选筛选、" +
    "Finalize 前置 1 Energy 费用和真实 draw 可由生产 binding 执行，但这不闭合完整对局路径；" +
    "apps/game-server/src/room.ts:236-246 的 deckPrograms 也只收集 mainDeck/legend/champion，没有 Battlefield program。",
  sourceText:
    "When you conquer here with one or more [Mighty] units, you may pay :rb_energy_1: to draw 1. (A unit is Mighty while it has 5+ :rb_might:.)",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // 053.3 / 383.4.c.2.b: the event's Battlefield must be this host's
        // Battlefield, and "you" is the ability controller at that Score.
        filter: { event: "conquered", here: true, player: "controller" },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            // The controller of the conquering Units is fixed by 383.4.c.2.b.
            // sameLocationAs limits the count to this Battlefield. The payload
            // still has to bind the participating-Unit set before the whole
            // condition can be executable as printed.
            subject: "conquering-mighty-units-at-this-battlefield",
            filter: {
              type: "unit",
              controller: "controller",
              mightGte: 5,
              sameLocationAs: "source"
            }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: true,
      body: [
        {
          id: "sunken-temple.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 Energy to draw 1?" },
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
