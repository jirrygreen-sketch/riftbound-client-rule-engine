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
 *   ActivatedAbility.restriction; the merged chain has no consumer for a card
 *   restriction yet. The parenthesised sentence is reminder text and not a second
 *   ability.
 *
 * status (cards/README.md section 2): judge-required, for two reasons.
 * 1. Universal Power has no executable value. The closed Domain union and the
 *    gain-power action cannot express "spendable as any domain" (163.2.b), so the
 *    body instruction is negated(impossible) by the merged primitive rather than
 *    silently gaining one of the six printed domains. This is a contract-level
 *    gap; the golden test locks the negative evidence.
 * 2. The printed use restriction has no consumer: nothing reads a program's
 *    ActivatedAbility.restriction, so the added Power could not be confined to
 *    playing gear or using gear abilities (204.4.b.1 family).
 * The exhaust cost itself is fully supported: cost/plan-values.ts accepts
 * `{ kind: "exhaust", object }` and cost/payment.ts checks that the source is a
 * ready, controlled object on the Board, so the golden test pays it for real.
 * The Legend's own zone is a separate, already-recorded contract gap (CR 107.4.c
 * puts a Champion Legend in the Legend Zone; the frozen ZoneId union has no
 * legend-zone), which the sibling Legends record and which this program does not
 * try to work around.
 * Dependencies: Universal Power support (contract change) and a rules adapter
 * for the custom restriction kind (the merged translateRestriction path only
 * passes through Condition kinds and fails closed otherwise). Nothing is
 * approximated: no domain is chosen for [A],
 * and the restriction is declared rather than dropped.
 */
export default {
  canonicalCardId: "card.hash-4f7b6e74a78c84b04922aadf51f0f8ef02368e59a4158f98eec18e4f301f75fe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) 任意域（Universal）Power 没有可执行值——135.2.e.5 / 163.2.b 的 [A] " +
    "必须能当作任一域的 Power 支付，但契约与内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order 六域封闭集合，" +
    "effect.resources 明确记录 Universal Power 不可表达、绝不用某个域近似，故正文只保留描述性 power: [\"rainbow\"]，" +
    "原语按 negated(impossible) 拒绝（属契约级缺口，golden 锁定该负证据）；" +
    "(2) 印刷的「Use only to play gear or use gear abilities.」是所加资源的用途限制（204.4.b.1 的限制家族），" +
    "但激活限制的翻译路径（programs/play.ts 的 translateRestriction→ChainDraft.restrictions）只透传 Condition 种类的 kind，" +
    "本卡的自定义 kind 需要规则适配器，无法保证该 Power 只用于打出装备或使用装备能力。" +
    "已被支持并可真实执行的部分：印刷 :rb_exhaust: 费用（404.1.a / 415.5）在 cost/plan-values.ts 与 cost/payment.ts " +
    "里是真实可支付的启动费用，golden 会实际支付它；[Reaction] 按 813.1.c.2 / 813.1.d 用 activated.timing = \"reaction\" 声明。" +
    "另注（非本卡可解）：Champion Legend 的来源区域是 Legend Zone（107.4.c），契约 ZoneId 与参考内核都没有该区域，" +
    "同批传奇卡记录同一缺口，本程序不绕过。",
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
