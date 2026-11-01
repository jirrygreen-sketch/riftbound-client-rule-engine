import type { V2ActivationOption, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";
import type { V2CommandRequest } from "../../transport/v2";
import { officialKeywordName } from "./keyword-names";

/**
 * Activated abilities (RIFT-1183). The server lists exactly the abilities the
 * viewer may begin right now in `actionOptions.activations` (RIFT-1167); the
 * client only offers those and sends `activate`, and any target or cost
 * question comes back as an ordinary pending choice.
 */

/** Every listed ability, in server order; older projections list none. */
export function v2Activations(projection: V2Projection): readonly V2ActivationOption[] {
  return projection.actionOptions?.activations ?? [];
}

/** The listed abilities of one source object, in server order. */
export function v2ActivationsFor(projection: V2Projection, sourceObjectId: string): readonly V2ActivationOption[] {
  return v2Activations(projection).filter(option => option.sourceObjectId === sourceObjectId);
}

export function v2ActivationSourceIds(projection: V2Projection): ReadonlySet<string> {
  return new Set(v2Activations(projection).map(option => option.sourceObjectId));
}

/**
 * The ability's name in official Chinese only. A keyword ability such as Equip
 * uses its attested zh-CN keyword name; any other label is English card text,
 * which is never translated here, so the ability is numbered among its card's
 * abilities instead (the card itself shows its official text on hover).
 */
export function v2ActivationLabel(option: V2ActivationOption, siblings: readonly V2ActivationOption[]): string {
  const keyword = officialKeywordName(option.label);
  const index = siblings.indexOf(option);
  const name = keyword !== undefined ? `[${keyword}]` : siblings.length > 1 && index >= 0 ? `能力 ${index + 1}` : "能力";
  return option.reaction === true ? `${name}（${officialKeywordName("reaction")}）` : name;
}

export function buildV2ActivateCommand(option: V2ActivationOption): V2CommandRequest {
  return { type: "activate", sourceObjectId: option.sourceObjectId, abilityId: option.abilityId };
}
