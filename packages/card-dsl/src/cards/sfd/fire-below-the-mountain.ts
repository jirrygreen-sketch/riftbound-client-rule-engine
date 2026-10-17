import type { CardProgram } from "../../ir/index.js";

/**
 * Fire Below the Mountain (sfd-189-221 / sfd-244-221) — Legend, Calm/Mind, tag Ornn.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-189-221, verbatim):
 *   ":rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:. Use only to play gear or
 *    use gear abilities. (Abilities that add resources can't be reacted to.)"
 *
 * Rules evidence (Core Rules v1.5):
 * - 404.1.a / 735.2.e.2 / 415.5: everything before the printed "—" is the
 *   activated ability's base cost, and the printed :rb_exhaust: symbol is "Exhaust
 *   this" (735.2.e.2 names the exhaust symbol's shorthand [E]). That cost is
 *   declared as an `exhaust` payment on the source, charged by the chain at
 *   Finalize (contract 3.5).
 * - 813.1 / 813.1.a / 813.1.c.2 / 813.1.d: [Reaction] is the Permissive keyword;
 *   on an ability it is written "[Reaction][>]" and grants Closed-State activation
 *   on any player's turn. IR records that as `activated.timing: "reaction"`, the
 *   spelling sfd/danger-zone.ts and ogn/seal-of-unity.ts use for the same printed
 *   shape; the keyword itself is not re-declared as a card-level keyword, because
 *   813.1.a places it on Legend Abilities as an ability permission.
 * - 430.1 / 430.4 / 430.5: "[Add]" is the Add action; 430.5's example fixes
 *   "[E]: Add [Y]." as "Add 1 Power of the Y domain". The printed symbol is the
 *   swirling rainbow [A]: 135.2.e.5 defines [A] as "Power of any Domain" and
 *   163.2.b defines that Power as Universal. The merged Domain union is the
 *   closed six-domain set, and effect.resources documents that Universal Power is
 *   not representable and must never be approximated by a chosen domain, so the
 *   descriptive `["rainbow"]` spelling is kept exactly as rad/iron-revenant.ts,
 *   ogn/daughter-of-the-void.ts and ven/matriarch-of-war.ts do.
 * - "Use only to play gear or use gear abilities." is a use restriction on the
 *   resources this ability adds (204.4.b.1's restriction family), declared through
 *   ActivatedAbility.restriction; translating that custom kind still needs a
 *   rules adapter. The parenthesised sentence is reminder text and not a second
 *   ability.
 *
 * Current status: judge-required. Universal Power and spending provenance are
 * unrepresented; the custom resource restriction needs a rules adapter.
 * programs/activate.ts also emits activated rather than add drafts, so this
 * card cannot use the chain's Add timing paths. Legend Zone remains unbound.
 * Exhaust-cost execution on a Board fixture is only partial evidence.
 */
export default {
  canonicalCardId: "card.hash-4f7b6e74a78c84b04922aadf51f0f8ef02368e59a4158f98eec18e4f301f75fe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Universal Power [A]（135.2.e.5 / 163.2.b）仍无法由 Domain/gain-power 表示或支付；effect.resources 仅接受六域 Power。" +
    "所加 Power 的用途 restriction（只用于打出 gear 或 gear abilities，204.4.b.1）缺少资源来源/支付用途绑定，" +
    "programs/play.ts 的 translateRestriction 也拒绝自定义 kind。programs/activate.ts 固定生成 kind=activated，" +
    "尚未把本能力分到 ChainDraft.kind=add，因此 430.2/430.3 的立即结算与支付期间 Add 路径不能从本卡进入。" +
    "Legend Zone（107.4.a–d）也不在 ZoneId 中，无法绑定传奇真实来源区域与横置费用。保持 judge-required。",
  abilities: [
    {
      kind: "activated",
      // 813.1.c.2 / 813.1.d: "[Reaction][>]" on an ability is a Closed-State
      // activation permission; IR declares it as reaction timing.
      timing: "reaction",
      cost: {
        kind: "activated",
        // 404.1.a / 415.5: the printed :rb_exhaust: before the dash is the base
        // cost "Exhaust this" — a real, payable cost, not a body instruction.
        payments: [{ kind: "exhaust", object: "self" }]
      },
      // 204.4.b.1: "Use only to play gear or use gear abilities." restricts what
      // the added Power may pay for; declared here, with no merged consumer.
      restriction: { kind: "use-only-to-play-gear-or-gear-abilities" },
      body: [
        {
          id: "fire-below-the-mountain.add-universal-power",
          // 430.1 / 430.5: Add one Power of the printed [A]. [A] is Universal
          // (135.2.e.5 / 163.2.b) and has no executable value in the closed
          // six-domain union, so the descriptive "rainbow" spelling is kept and
          // the merged primitive returns negated(impossible) instead of guessing
          // a domain.
          op: "effect.resources",
          args: {
            power: { kind: "constant", value: ["rainbow"] }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:. " +
    "Use only to play gear or use gear abilities. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;
