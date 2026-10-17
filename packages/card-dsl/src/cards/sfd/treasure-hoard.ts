import type { CardProgram } from "../../ir/index.js";

/**
 * Treasure Hoard (sfd-220-221) — Battlefield, Rumble precon.
 *
 * "When you conquer here, you may pay {1 energy} to play a Gold gear token
 *  exhausted."
 *
 * Status rationale (cards/README.md §2): judge-required — the current gaps are:
 * 1. the Gold gear token definition is still absent from the frozen
 *    effect.token table. CR v1.5 187.5 defines it as a domainless gear token
 *    with "[Reaction][>] Kill this, [E]: [Add] [A]."; effect.token.ts keeps
 *    definitions that require their own abilities (including Gold) blocked, and
 *    the merged primitive returns
 *    blockedReason "token-definition-or-abilities-judge-required" for it
 *    (verified by the golden);
 * 2. the printed "play a Gold gear token" is authored as the single merged
 *    effect.token mode "play", which creates on the Chain and hands the new
 *    object to the play flow (440.2.c / 185.2.a / 350.2 / 354; the golden drives
 *    create + play with a definition the frozen table does have). A separate
 *    effect.play is not authored: mode "play" already plays the created token,
 *    and tokens carry null costs (185.3), so there is no printed cost to waive.
 *    The printed text names no destination, so the program keeps a descriptive
 *    destination marker (the primitive rejects it fail-closed rather than
 *    guessing a location);
 * 3. "exhausted" is an entry override (143.4 / 185.2.d) the create-token action
 *    explicitly does not support ("Entry overrides are not supported"), so the
 *    token cannot be authored as entering exhausted;
 * 4. the trigger's `here` placeholder still needs the conquer battlefield
 *    anchor to resolve to a concrete location (RIFT-357/RIFT-359).
 *
 * The abilities below still encode the full intended shape so downstream
 * tooling can see the trigger, cost and play structure; execution is judged.
 */
export default {
  canonicalCardId: "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Gold gear token definition (CR v1.5 187.5: domainless gear token with \"[Reaction][>] Kill this, [E]: [Add] [A].\") is absent from the frozen effect.token definition table; " +
    "the merged primitive returns blockedReason \"token-definition-or-abilities-judge-required\". Playing the new token needs the chain-create + cost-waived play flow " +
    "(440.2.c/185.2.a/350.2/354): effect.token mode \"play\" already creates on the Chain and hands the object to the play flow; tokens carry null costs (185.3), so no separate cost-waived " +
    "effect.play is authored. The create-token action does not support the 'exhausted' entry override " +
    "(143.4/185.2.d). The conquer trigger's `here` anchor still needs the event battlefield identity " +
    "to become a location filter (RIFT-357/RIFT-359); the printed Energy payment is represented by the merged cost.pay primitive.",
  sourceText: "When you conquer here, you may pay :rb_energy_1: to play a Gold gear token exhausted.",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "conquer", filter: { event: "conquer", here: true, player: "controller" } },
      optional: true,
      body: [
        {
          id: "treasure-hoard.opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy to play a Gold gear token exhausted?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "treasure-hoard.pay",
                  op: "cost.pay",
                  args: { payments: { kind: "constant", value: { energy: 1 } } }
                },
                {
                  id: "treasure-hoard.create",
                  op: "effect.token",
                  linkedTo: "treasure-hoard.pay",
                  args: {
                    token: { kind: "constant", value: "gold" },
                    // 印刷的 "play a … token"：已合入的 effect.token mode "play" 会在链上创建
                    // 新 token（440.2.c / 185.2.a / 350.2 / 354），再交给打出流程；见 judgeReason
                    // 第 2 点（Gold 定义与零费用计划仍缺）。
                    mode: { kind: "constant", value: "play" },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "goldToken" },
                    // 目的地标记：印刷文本没有给出战场身份，可执行的 LocationRef 由链的
                    // 打出流程决定；这里是描述性形状，原语会拒绝它（fail-closed），
                    // 不会把 token 放到猜测的地点。
                    location: {
                      kind: "constant",
                      value: { kind: "destination-selector", filter: { controllerBase: true } }
                    }
                  }
                },
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
