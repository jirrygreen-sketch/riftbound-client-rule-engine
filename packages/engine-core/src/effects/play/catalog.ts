import type { CardProgram, CostSpec, PlayAbility } from "@riftbound/card-dsl";
import type { DuelPrintedCostCatalogCard } from "../../cost/printed-costs.js";
import { cardProgramsById } from "../../../../card-dsl/dist/cards/registry.generated.js";

export type EffectPlayPrintedProjection = DuelPrintedCostCatalogCard;
const DOMAIN_LABELS = new Set(['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'Colorless']);

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

/** Read the same catalog projection shape used by ordinary card Play. */
export function printedProjectionFor(descriptor: Record<string, unknown>): EffectPlayPrintedProjection | undefined {
  const value = record(descriptor.printed);
  if (value === null) return undefined;
  if (typeof value.id !== 'string' || value.id.length === 0 ||
      typeof value.cardType !== 'string' || value.cardType.length === 0 ||
      !Array.isArray(value.domains) || value.domains.some(domain =>
        typeof domain !== 'string' || !DOMAIN_LABELS.has(domain)) ||
      value.energy !== null && (typeof value.energy !== 'number' || !Number.isSafeInteger(value.energy) || value.energy < 0) ||
      value.power !== null && (typeof value.power !== 'number' || !Number.isSafeInteger(value.power) || value.power < 0)) {
    return undefined;
  }
  return {
    id: value.id,
    cardType: value.cardType,
    domains: [...value.domains] as string[],
    energy: value.energy as number | null,
    power: value.power as number | null
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
