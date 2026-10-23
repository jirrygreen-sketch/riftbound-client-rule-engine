import type { CardProgram, CostSpec, PlayAbility } from "@riftbound/card-dsl";
import type { DuelPrintedCostCatalogCard } from "../../cost/printed-costs.js";
import { cardProgramsById } from "../../../../card-dsl/dist/cards/registry.generated.js";

export type EffectPlayPrintedProjection = DuelPrintedCostCatalogCard;
export type EffectPlayPrintedCatalog = (canonicalCardId: string) => EffectPlayPrintedProjection | undefined;
const DOMAIN_LABELS = new Set(['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'Colorless']);
const capabilityCatalogs = new WeakMap<object, EffectPlayPrintedCatalog>();

/** Read the generated card-program directory without mutating or admitting it. */
export function cardProgramFor(cardId: string | null): CardProgram | undefined {
  return cardId === null ? undefined : cardProgramsById.get(cardId) as CardProgram | undefined;
}

export function playAbilityFor(program: CardProgram | undefined): PlayAbility | undefined {
  return program?.abilities.find((ability): ability is PlayAbility => ability.kind === "play");
}

export function playCostFor(program: CardProgram | undefined): CostSpec | undefined {
  return playAbilityFor(program)?.cost;
}

/** Parse the same catalog projection shape used by ordinary card Play. */
export function catalogProjectionFor(value: unknown): EffectPlayPrintedProjection | undefined {
  const item = record(value);
  if (item === null) return undefined;
  const { id, cardType, domains, energy, power } = item;
  if (typeof id !== 'string' || id.length === 0 ||
      typeof cardType !== 'string' || cardType.length === 0 ||
      !Array.isArray(domains) || domains.some(domain =>
        typeof domain !== 'string' || !DOMAIN_LABELS.has(domain)) ||
      energy !== null && (typeof energy !== 'number' || !Number.isSafeInteger(energy) || energy < 0) ||
      power !== null && (typeof power !== 'number' || !Number.isSafeInteger(power) || power < 0)) {
    return undefined;
  }
  return {
    id,
    cardType,
    domains: [...domains] as string[],
    energy: energy as number | null,
    power: power as number | null
  };
}

/** Read an inline projection from a play-cost descriptor. */
export function printedProjectionFor(descriptor: Record<string, unknown>): EffectPlayPrintedProjection | undefined {
  return catalogProjectionFor(descriptor.printed);
}

/** Resolve inline data first, then the selected card's binding-owned directory row. */
export function selectedPrintedProjectionFor(
  descriptor: Record<string, unknown>,
  canonicalCardId: string | null = null,
  lookup?: EffectPlayPrintedCatalog
): EffectPlayPrintedProjection | undefined {
  if (descriptor.printed !== undefined) return printedProjectionFor(descriptor);
  if (canonicalCardId === null || lookup === undefined) return undefined;
  return catalogProjectionFor(lookup(canonicalCardId));
}

/** Register the binding lookup on the exact capability object the interpreter preserves. */
export function bindPrintedCatalogCapability(
  capability: object,
  lookup: EffectPlayPrintedCatalog
): void {
  capabilityCatalogs.set(capability, lookup);
}

/** Resolve the binding lookup through a copied contract capability object. */
export function selectedCapabilityProjectionFor(
  descriptor: Record<string, unknown>,
  capability: object | undefined,
  canonicalCardId: string | null
): EffectPlayPrintedProjection | undefined {
  if (descriptor.printed !== undefined) return printedProjectionFor(descriptor);
  if (canonicalCardId === null || capability === undefined) return undefined;
  const lookup = capabilityCatalogs.get(capability);
  return lookup === undefined ? undefined : catalogProjectionFor(lookup(canonicalCardId));
}

/** Copy a trusted projection; CostPlan freezes the target before Resolve. */
export function freezePrintedProjection(
  projection: EffectPlayPrintedProjection
): EffectPlayPrintedProjection {
  return {
    id: projection.id,
    cardType: projection.cardType,
    domains: [...projection.domains],
    energy: projection.energy,
    power: projection.power
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
