import type {
  CardProgram,
  DeckbuildingDecision
} from "@riftbound/card-dsl";

/** Minimal catalog information needed by deckbuilding rules. */
export interface DeckCardDefinition {
  readonly id?: string;
  readonly cardId?: string;
  readonly canonicalCardId?: string;
  /** Name may be omitted in a submission and filled from the trusted catalog. */
  readonly name?: string;
  readonly cardType?: string;
  readonly types?: readonly string[];
}

/** A submitted card entry. `quantity` is deliberately kept separate from the card identity. */
export interface DeckCardEntry extends DeckCardDefinition {
  readonly quantity: number;
}

export interface DeckSubmission {
  readonly mainDeck?: readonly DeckCardEntry[];
  readonly sideboard?: readonly DeckCardEntry[];
  readonly legend?: DeckCardEntry | readonly DeckCardEntry[];
  readonly champion?: DeckCardEntry | readonly DeckCardEntry[];
  /** The three extra Legends selected by a 103.1 deckbuilding decision. */
  readonly additionalLegends?: readonly DeckCardDefinition[];
}

export interface DeckbuildingSource {
  readonly canonicalCardId: CardProgram["canonicalCardId"];
  readonly deckbuilding?: CardProgram["deckbuilding"];
  readonly abilities?: CardProgram["abilities"];
  /** Trusted catalog name for the card that supplied the decision. */
  readonly sourceName?: string;
}

export interface DeckbuildingValidationInput {
  readonly programs?: readonly DeckbuildingSource[];
  readonly catalog?: readonly DeckCardDefinition[];
  readonly decisions?: readonly DeckbuildingDecision[];
  readonly startingLegend?: DeckCardDefinition;
  readonly defaultMaxCopies?: number;
}

export type DeckbuildingIssueCode =
  | "invalid-deck"
  | "invalid-entry"
  | "unknown-decision"
  | "invalid-decision"
  | "additional-legends-not-permitted"
  | "additional-legends-count"
  | "additional-legend-not-legend"
  | "additional-legend-duplicate-name"
  | "additional-legend-matches-starting"
  | "copy-limit-exceeded"
  | "unique-copy-limit-exceeded"
  | "unlimited-copy-rule-unresolved";

export interface DeckbuildingIssue {
  readonly code: DeckbuildingIssueCode;
  readonly message: string;
  readonly cardId?: string;
  readonly name?: string;
  readonly limit?: number;
  readonly actual?: number;
}

export interface DeckbuildingRules {
  readonly additionalLegendCount: number;
  readonly unlimitedNames: readonly string[];
  readonly uniqueNames: readonly string[];
  readonly issues: readonly DeckbuildingIssue[];
}

export interface DeckbuildingValidationResult {
  readonly valid: boolean;
  readonly issues: readonly DeckbuildingIssue[];
  readonly rules: DeckbuildingRules;
  readonly copyCounts: Readonly<Record<string, number>>;
}

const DEFAULT_MAX_COPIES = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function id(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function canonicalOf(card: DeckCardDefinition): string | undefined {
  return id(card.canonicalCardId) ?? id(card.cardId) ?? id(card.id);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sourceName(source: DeckbuildingSource, catalog: ReadonlyMap<string, DeckCardDefinition>): string | undefined {
  if (id(source.sourceName)) return source.sourceName;
  return catalog.get(source.canonicalCardId)?.name;
}

function catalogById(catalog: readonly DeckCardDefinition[]): ReadonlyMap<string, DeckCardDefinition> {
  const result = new Map<string, DeckCardDefinition>();
  for (const card of catalog) {
    for (const key of [card.cardId, card.id, card.canonicalCardId]) {
      const value = id(key);
      if (value !== undefined) result.set(value, card);
    }
  }
  return result;
}

function resolveCard(
  card: DeckCardDefinition,
  byId: ReadonlyMap<string, DeckCardDefinition>
): { readonly catalog?: DeckCardDefinition; readonly canonical?: string; readonly name?: string } {
  const lookup = [card.cardId, card.id, card.canonicalCardId]
    .map(value => id(value))
    .find((value): value is string => value !== undefined);
  const catalogCard = lookup === undefined ? undefined : byId.get(lookup);
  return {
    catalog: catalogCard,
    canonical: id(card.canonicalCardId) ?? id(catalogCard?.canonicalCardId) ?? id(card.cardId) ?? id(card.id),
    name: id(card.name) ?? id(catalogCard?.name)
  };
}

function asInput(
  source: readonly DeckbuildingSource[] | DeckbuildingValidationInput | undefined,
  catalog: readonly DeckCardDefinition[] | undefined
): DeckbuildingValidationInput {
  if (Array.isArray(source)) return { programs: source, catalog };
  return { ...(source ?? {}), ...(catalog === undefined ? {} : { catalog }) };
}

/**
 * Collect the known v1.5 deckbuilding permissions. Repeated copies are
 * merged: Neeko's three additional Legends are one shared choice.
 */
export function collectDeckbuildingRules(
  programs: readonly DeckbuildingSource[] = [],
  catalog: readonly DeckCardDefinition[] = [],
  explicitDecisions: readonly DeckbuildingDecision[] = []
): DeckbuildingRules {
  const catalogByCanonical = new Map<string, DeckCardDefinition>();
  for (const card of catalog) {
    const key = canonicalOf(card);
    if (key !== undefined) catalogByCanonical.set(key, card);
  }
  const declarations: DeckbuildingDecision[] = [...explicitDecisions];
  let additionalLegendCount = 0;
  const unlimitedNames = new Set<string>();
  const uniqueNames = new Set<string>();
  const issues: DeckbuildingIssue[] = [];

  for (const decision of declarations) {
    if (!isRecord(decision) || typeof decision.kind !== "string") {
      issues.push({ code: "invalid-decision", message: "Deckbuilding decision is not a valid object." });
      continue;
    }
    const kind = normalized(decision.kind);
    if (kind === "choose-additional-legends") {
      if (!isPositiveInteger(decision.count)) {
        issues.push({ code: "invalid-decision", message: "choose-additional-legends requires a positive count." });
        continue;
      }
      additionalLegendCount = Math.max(additionalLegendCount, decision.count);
      continue;
    }
    if (kind === "unlimited-copies-of-this-name") {
      const name = id(decision.name) ?? id(decision.cardName) ??
        (decision.sourceCanonicalCardId === undefined ? undefined : catalogByCanonical.get(String(decision.sourceCanonicalCardId))?.name);
      if (name !== undefined) unlimitedNames.add(normalized(name));
      else issues.push({ code: "unlimited-copy-rule-unresolved", message: "Unlimited copy permission has no trusted card name." });
      continue;
    }
    if (kind === "unique" || kind === "unique-name" || kind === "unique-card-name") {
      const name = id(decision.name) ?? id(decision.cardName);
      if (name !== undefined) uniqueNames.add(normalized(name));
      else issues.push({ code: "invalid-decision", message: "Unique permission has no trusted card name." });
      continue;
    }
    issues.push({ code: "unknown-decision", message: `Unsupported deckbuilding decision: ${decision.kind}.` });
  }

  for (const program of programs) {
    for (const decision of program.deckbuilding ?? []) {
      const kind = normalized(decision.kind);
      const name = sourceName(program, catalogByCanonical);
      if (kind === "choose-additional-legends") {
        if (!isPositiveInteger(decision.count)) {
          issues.push({ code: "invalid-decision", message: "choose-additional-legends requires a positive count." });
        } else {
          additionalLegendCount = Math.max(additionalLegendCount, decision.count);
        }
      } else if (kind === "unlimited-copies-of-this-name") {
        if (name === undefined) issues.push({ code: "unlimited-copy-rule-unresolved", message: "Unlimited copy permission has no trusted card name.", cardId: program.canonicalCardId });
        else unlimitedNames.add(normalized(name));
      } else if (kind === "unique" || kind === "unique-name" || kind === "unique-card-name") {
        if (name === undefined) issues.push({ code: "invalid-decision", message: "Unique permission has no trusted card name.", cardId: program.canonicalCardId });
        else uniqueNames.add(normalized(name));
      }
    }
    for (const ability of program.abilities ?? []) {
      if (ability.kind !== "keyword" || normalized(ability.keyword) !== "unique") continue;
      const name = sourceName(program, catalogByCanonical);
      if (name === undefined) issues.push({ code: "invalid-decision", message: "Unique permission has no trusted card name.", cardId: program.canonicalCardId });
      else uniqueNames.add(normalized(name));
    }
  }

  return {
    additionalLegendCount,
    unlimitedNames: [...unlimitedNames].sort(),
    uniqueNames: [...uniqueNames].sort(),
    issues
  };
}

function entries(deck: DeckSubmission): readonly DeckCardEntry[] {
  const result = [...(deck.mainDeck ?? []), ...(deck.sideboard ?? [])];
  const zones = [deck.legend, deck.champion];
  for (const zone of zones) {
    if (zone === undefined) continue;
    result.push(...(Array.isArray(zone) ? zone : [zone]));
  }
  return result;
}

function activePrograms(
  deck: DeckSubmission,
  programs: readonly DeckbuildingSource[],
  catalog: readonly DeckCardDefinition[]
): readonly DeckbuildingSource[] {
  const byId = catalogById(catalog);
  const present = new Set<string>();
  for (const card of entries(deck)) {
    const resolved = resolveCard(card, byId);
    if (resolved.canonical !== undefined) present.add(resolved.canonical);
  }
  return programs.filter(program => present.has(program.canonicalCardId));
}

function startingLegendOf(deck: DeckSubmission, input: DeckbuildingValidationInput): DeckCardDefinition | undefined {
  if (input.startingLegend !== undefined) return input.startingLegend;
  const value = deck.legend;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.length === 0 ? undefined : value[0];
  return value as DeckCardDefinition;
}

function validateAdditionalLegends(
  deck: DeckSubmission,
  rules: DeckbuildingRules,
  input: DeckbuildingValidationInput
): DeckbuildingIssue[] {
  const selected = deck.additionalLegends ?? [];
  const issues: DeckbuildingIssue[] = [];
  const byId = catalogById(input.catalog ?? []);
  if (selected.length > 0 && rules.additionalLegendCount === 0) {
    issues.push({ code: "additional-legends-not-permitted", message: "Additional Legends require a 103.1 deckbuilding permission." });
    return issues;
  }
  if (selected.length !== 0 && selected.length !== rules.additionalLegendCount) {
    issues.push({ code: "additional-legends-count", message: `Expected exactly ${rules.additionalLegendCount} additional Legends.`, limit: rules.additionalLegendCount, actual: selected.length });
  }
  const names = new Set<string>();
  const starting = startingLegendOf(deck, input);
  const startingResolved = starting === undefined ? undefined : resolveCard(starting, byId);
  const startingName = startingResolved?.name === undefined ? undefined : normalized(startingResolved.name);
  for (const legend of selected) {
    if (!isRecord(legend)) {
      issues.push({ code: "invalid-entry", message: "Additional Legend entries require a card id and name." });
      continue;
    }
    const candidate = legend as unknown as DeckCardDefinition;
    const resolved = resolveCard(candidate, byId);
    if (resolved.name === undefined || resolved.canonical === undefined) {
      issues.push({ code: "invalid-entry", message: "Additional Legend entries require a known card id and name." });
      continue;
    }
    const type = candidate.cardType ?? candidate.types?.find(value => value.toLowerCase() === "legend") ?? resolved.catalog?.cardType;
    if (type !== undefined && normalized(type) !== "legend") {
      issues.push({ code: "additional-legend-not-legend", message: `${resolved.name} is not a Legend.`, name: resolved.name });
    }
    const key = normalized(resolved.name);
    if (names.has(key)) issues.push({ code: "additional-legend-duplicate-name", message: `Additional Legends must have different names: ${resolved.name}.`, name: resolved.name });
    names.add(key);
    if (startingName !== undefined && startingName === key) {
      issues.push({ code: "additional-legend-matches-starting", message: `${resolved.name} matches the starting Legend.`, name: resolved.name });
    }
  }
  return issues;
}

/** Validate the deckbuilding decisions owned by engine-core. */
export function validateDeckbuilding(
  deck: DeckSubmission,
  source: readonly DeckbuildingSource[] | DeckbuildingValidationInput = [],
  catalog?: readonly DeckCardDefinition[]
): DeckbuildingValidationResult {
  const input = asInput(source, catalog);
  const programs = input.programs ?? [];
  const active = activePrograms(deck, programs, input.catalog ?? []);
  const rules = collectDeckbuildingRules(active, input.catalog ?? [], input.decisions ?? []);
  const issues: DeckbuildingIssue[] = [...rules.issues, ...validateAdditionalLegends(deck, rules, input)];
  const defaultMaxCopies = input.defaultMaxCopies ?? DEFAULT_MAX_COPIES;
  if (!Number.isSafeInteger(defaultMaxCopies) || defaultMaxCopies < 1) {
    issues.push({ code: "invalid-decision", message: "defaultMaxCopies must be a positive safe integer." });
  }

  const byId = catalogById(input.catalog ?? []);
  const copyCounts: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const entry of entries(deck)) {
    if (!isRecord(entry) || !isPositiveInteger(entry.quantity)) {
      issues.push({ code: "invalid-entry", message: "Deck entries require a positive quantity, card id, and name." });
      continue;
    }
    const resolved = resolveCard(entry, byId);
    const canonical = resolved.canonical;
    const name = resolved.name;
    if (canonical === undefined || name === undefined) continue;
    copyCounts[canonical] = (copyCounts[canonical] ?? 0) + entry.quantity;
  }

  for (const [canonical, actual] of Object.entries(copyCounts)) {
    const catalogName = (input.catalog ?? []).find(card => canonicalOf(card) === canonical)?.name;
    const name = catalogName ?? canonical;
    const key = normalized(name);
    const limit = rules.uniqueNames.includes(key)
      ? 1
      : rules.unlimitedNames.includes(key)
        ? Number.POSITIVE_INFINITY
        : defaultMaxCopies;
    if (actual > limit) {
      issues.push({
        code: limit === 1 ? "unique-copy-limit-exceeded" : "copy-limit-exceeded",
        message: `${name} has ${actual} copies; the applicable limit is ${limit}.`,
        name,
        limit,
        actual
      });
    }
  }

  return { valid: issues.length === 0, issues, rules, copyCounts };
}

/** Alias used by callers that distinguish construction from in-game validation. */
export const validateDeckConstruction = validateDeckbuilding;
