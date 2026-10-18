import type { CardProgram } from "../../ir/index.js";

/**
 * Sudden Storm (sfd-017-221) — Spell, 3 Energy, no printed Power, Fury.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 2 to a unit at a battlefield. If it's attacking, deal 4 to it instead.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, sfd-017-221):
 * cardType Spell, domains ["Fury"], energy 3, power null, might null, tags [].
 * power null means no printed Power and is never rewritten as 0.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) and [Action] (806) are keyword abilities declared on the
 *   card; Hidden's expansion (811.1.b Hide permission, 811.1.c.2 Discretionary
 *   Action, 811.6 Reaction from the next turn) and Action's Showdown permission
 *   (806.1.c, 159.2.a) are owned by the keyword registry, the cost/zone work and
 *   the chain's timing query (contract 3.5/3.7). The card names both keywords
 *   and nothing more.
 * - "a unit at a battlefield" is a Choice of a specific Game Object in a Public
 *   zone, so the unit is Targeted (355.5, 355.7, 355.10.a); "at a battlefield"
 *   is a targeting restriction on that unit and does not target a battlefield
 *   (355.10.b). It is carried as the TargetSpec's own `location` field (the
 *   merged `TargetRequirement.location`).
 * - "If it's attacking, deal 4 to it instead" replaces the amount for the same
 *   target when that target is an attacker. It is one Deal action whose amount
 *   depends on the target's combat state, so the program states the two printed
 *   amounts as two mutually exclusive `effect.damage` instructions over the same
 *   TargetSpec, each guarded by a per-instruction `condition` (contract 3.4:
 *   a condition clause scopes to the instruction that owns it). "it" refers to
 *   the unit chosen by the preceding sentence, so the second instruction is
 *   `linkedTo` the first (359.3.e.14). Both instructions resolve the same
 *   Finalize-locked target set (355.8), and a stale target ignores both
 *   (359.3.e.14.a).
 * - "attacking" means the unit currently holds the Attacker designation
 *   (807.1.d.1 / 461 defines the designation gained in Combat). Contract 3.8
 *   adds `combatRole: "attacker" | "defender" | null` to `ObjectSnapshot` for
 *   exactly this reading; the condition below reads it as
 *   `object-property(target, "combatRole")` through the merged expression
 *   interpreter.
 *
 * Status: judge-required (2026-10-18 review). The attacker branch and the printed
 * [Action] speed permission are executable: the condition reads the merged
 * ObjectSnapshot.combatRole characteristic, and abilitySpeed turns the declared
 * action keyword into draft speed "action", which the real chain admits during a
 * Showdown with Focus and refuses in an opponent's ordinary Main phase.
 * [Hidden] remains the blocker: its expanded `cost.hidden` static has no consumer
 * that grants Hide, facedown storage, or the facedown Reaction play permission,
 * and the merged static binder rejects that static with "Static ability kind
 * cost.hidden has no layer mapping", so the printed Hide permission still has no
 * production path. The [Action] keyword's own `continuous.timing` expansion is
 * likewise still rejected by the binder ("Unsupported static appliesTo"), which
 * does not block admission only because the speed comes from the declaration.
 */
const TARGET_ID = "sudden-storm.unit-at-battlefield";

const target = {
  id: TARGET_ID,
  // 355.9.a.1: "unit" means a Board object unless stated otherwise; the
  // battlefield restriction is the merged TargetRequirement.location.
  filter: { type: "unit", zone: "board" },
  location: { type: "battlefield" },
  min: 1,
  max: 1,
  selection: "one"
} as const;

export default {
  canonicalCardId: "card.hash-574418734c3b92b767c220f89099980a68fad40a1074ee6c38bc88c7efb84771",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "阻断整卡的当前缺口是 [Hidden]：其展开（effects/keywords/Hidden.ts）是 static cost.hidden，" +
    "而 programs/statics.ts 实测以 \"Static ability kind cost.hidden has no layer mapping\" 拒绝该静态能力；" +
    "当前链/区域流程也没有据此授予 Hide 动作、facedown 区域存储或从 facedown 打出的许可（CR 811.1.b/811.1.c/811.6）。" +
    "已可执行并有 golden 实测：印刷 [Action]（806.1.c）经 programs/keywords.ts 的 abilitySpeed 变成 draft speed \"action\"，" +
    "真实 ChainEngine 在 Showdown 取得 Focus 时放行、在对手的普通 Main 阶段以 Action is not legally timed 拒绝；" +
    "[Action] 自身的 continuous.timing 展开仍被静态绑定器以 Unsupported static appliesTo 拒绝（appliesTo: [\"card\",\"activated-ability\"]），" +
    "但打出许可来自声明速度，不依赖该静态能力。" +
    "「If it's attacking」所需 ObjectSnapshot.combatRole 已在契约中存在，条件解释器按 attacker 分支求值（2/4 两个互斥分支）。" +
    "保持整卡 judge-required，不把 Hidden 近似成普通打出或公开区域。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // Printed cost (3 Energy, no Power) comes from the catalog; the Finalize
      // cost plan is its consumer.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // "Deal 2 to a unit at a battlefield" — the printed amount for a unit
          // that is not an attacker.
          id: "sudden-storm.deal-2",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            target: { kind: "constant", value: TARGET_ID }
          },
          targets: [target],
          condition: {
            kind: "not",
            condition: {
              kind: "compare",
              left: {
                kind: "object-property",
                object: { target: TARGET_ID },
                property: "combatRole"
              },
              operator: "eq",
              right: { kind: "constant", value: "attacker" }
            }
          }
        },
        {
          // "If it's attacking, deal 4 to it instead" — the replacement amount
          // for the same chosen unit (359.3.e.14: "it" references the unit of
          // the first sentence, hence the link).
          id: "sudden-storm.deal-4",
          op: "effect.damage",
          linkedTo: "sudden-storm.deal-2",
          args: {
            amount: { kind: "constant", value: 4 },
            target: { kind: "constant", value: TARGET_ID }
          },
          targets: [target],
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { target: TARGET_ID },
              property: "combatRole"
            },
            operator: "eq",
            right: { kind: "constant", value: "attacker" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 2 to a unit at a battlefield. If it's attacking, deal 4 to it instead."
} satisfies CardProgram;
