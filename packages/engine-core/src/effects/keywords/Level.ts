import type { Ability, Value } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * [Level N] — dependent keyword expansion (Core Rules v1.5 §824).
 *
 * The dependent ability text that follows `[>]` belongs to the card program;
 * this keyword only publishes the predicate that makes that text active.  The
 * resulting static ability is consumed by the condition/layers pipeline, so
 * this file does not inspect XP or run any game flow itself.
 *
 * Dependencies not yet merged (the expansion deliberately keeps these
 * contract shapes instead of approximating them):
 * - `condition.value` / `condition.predicate` consumption by the continuous
 *   layers and dependent-ability binder (RIFT-258/259 and the engine batch 4
 *   binding work) must evaluate the controlling player's live XP.
 * - Player-side XP is not currently an Expr-readable ObjectSnapshot
 *   characteristic.  The `controller-xp` query descriptor below is therefore
 *   a contract-level query for that future evaluator; it must not be treated
 *   as a generic object count or coerced to zero.
 * - `KeywordDef.expand` currently has no instance/text parameter.  A card
 *   compiler must attach the `[>]` dependent ability and, when needed, its
 *   instance identity around this predicate.
 */

/** v1.5 §824 references the controller's XP threshold as an active predicate. */
export const LEVEL_PREDICATE = "level-active" as const;

const LEVEL_RULE_REFS = [
  "824",
  "824.1",
  "824.1.a",
  "824.1.b",
  "824.1.b.1",
  "824.1.b.2",
  "824.1.c",
  "824.1.c.1",
  "824.1.d",
  "824.2"
] as const;

export interface LevelInput {
  readonly value?: number;
  readonly host: CardContextRef;
  /** Reserved for the v1.1 compiler extension; ignored by this predicate. */
  readonly params?: Readonly<Record<string, Value | undefined>>;
}

const level = {
  keyword: "Level",
  // §824.1.a formats the keyword as [Level N].
  valued: true,
  // Every [Level N][>] clause carries its own dependent text and threshold;
  // multiple clauses are therefore independent, not a numeric sum.
  stacking: "separate",
  expand(input: LevelInput): readonly Ability[] {
    // §824.1.a requires N.  The public KeywordDef keeps `value` optional for
    // all keywords, so a missing Level value is represented as null (missing
    // information) rather than inventing a numeric default or activating it.
    const threshold = input.value ?? null;
    const predicate: Ability = {
      kind: "static",
      effect: {
        kind: "condition.predicate",
        id: `level:${input.host.canonicalCardId}:${String(threshold)}:predicate`,
        link: "active",
        predicate: LEVEL_PREDICATE,
        subject: "self",
        controller: "controller",
        characteristic: "xp",
        query: "controller-xp",
        operator: "gte",
        threshold: { kind: "constant", value: threshold },
        ruleRefs: [...LEVEL_RULE_REFS]
      },
      condition: { kind: "always" }
    };
    return Object.freeze([predicate]);
  },
  ruleRefs: LEVEL_RULE_REFS
} satisfies KeywordDef;

export default level as KeywordDef;
