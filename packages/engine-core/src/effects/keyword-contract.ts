import type { Ability, KeywordId } from "@riftbound/card-dsl";

/**
 * Reference to the card that hosts a keyword, passed to {@link KeywordDef.expand}.
 * Expansions only need the card identity; live object state is read later through
 * ResolveContext when the expanded abilities resolve.
 */
export interface CardContextRef {
  readonly canonicalCardId: string;
}

/**
 * How several copies of the same keyword on one object combine
 * (P0 contract 3.7). "sum" merges them into one ability whose value is the
 * total (v1.5 Assault / Shield / Disarm); "single" counts the keyword once;
 * "separate" keeps every copy as an independent ability.
 */
export type KeywordStacking = "sum" | "single" | "separate";

/**
 * One keyword per file under `effects/keywords/<keyword>.ts`, default-exported
 * and indexed by `keyword` in the generated registry (P0 contract 3.7).
 * A keyword never runs game flow itself; it only expands into EffectIR
 * abilities that the interpreter, timing points and chain execute.
 */
export interface KeywordDef {
  /** Name exactly as printed between brackets, e.g. "Assault", "Quick-Draw". */
  readonly keyword: KeywordId;
  /** Whether the keyword carries a number (Assault 2, Shield 2, Deflect 1…). */
  readonly valued: boolean;
  readonly stacking: KeywordStacking;
  /** Expand into abilities that must pass validateCardProgram. */
  expand(input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[];
  /** Core Rules v1.5 rule numbers backing the expansion. */
  readonly ruleRefs: readonly string[];
}
