import type { V2HideOption, V2ProjectedObject, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";
import type { V2CommandRequest } from "../../transport/v2";
import { officialKeywordName } from "./keyword-names";

/**
 * Hidden (RIFT-1185, CR 811). The server lists in `actionOptions.hides` each
 * hand card the viewer may Hide now and where; the client offers only those
 * and sends `hide`. A hidden card is played later through an ordinary listed
 * `play` of its facedown object.
 */

/** Official zh-CN name of the keyword, e.g. 待命. */
export const V2_HIDDEN_LABEL = officialKeywordName("hidden")!;

export function v2HideOptionsFor(projection: V2Projection, cardObjectId: string): readonly V2HideOption[] {
  return (projection.actionOptions?.hides ?? []).filter(option => option.cardObjectId === cardObjectId);
}

/** A card the viewer hid at a Battlefield; only its owner's projection carries its face. */
export function v2IsOwnHidden(object: V2ProjectedObject, viewerPlayerId: string | null): boolean {
  return object.zone === "facedown" && object.faceDown && object.cardId !== undefined &&
    viewerPlayerId !== null && object.ownerPlayerId === viewerPlayerId;
}

/** A Facedown Zone card at a Battlefield, the viewer's or an opponent's. */
export function v2IsHiddenAtBattlefield(object: V2ProjectedObject): boolean {
  return object.zone === "facedown" && object.location?.kind === "battlefield";
}

export function buildV2HideCommand(option: V2HideOption): V2CommandRequest {
  return { type: "hide", cardObjectId: option.cardObjectId, battlefieldId: option.battlefieldId };
}
