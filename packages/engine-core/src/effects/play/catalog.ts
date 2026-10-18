import type { CardProgram, CostSpec, PlayAbility } from "@riftbound/card-dsl";
import { cardProgramsById } from "../../../../card-dsl/dist/cards/registry.generated.js";

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
