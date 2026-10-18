import type {
  Expr, PlayerPropertyExpr, PlayerSelector, PlayerTurnCountExpr, TurnNumberExpr, ObjectDesignationExpr
} from "../../dist/index.js";

const player = { controllerOf: "self" } satisfies PlayerSelector;
const points = { kind: "player-property", player, property: "points" } satisfies PlayerPropertyExpr;
const turn = { kind: "turn-number" } satisfies TurnNumberExpr;
const ownTurns = { kind: "player-turn-count", player } satisfies PlayerTurnCountExpr;
const designation = { kind: "object-designation", object: "source" } satisfies ObjectDesignationExpr;
export const expressions: readonly Expr[] = [points, turn, ownTurns, designation, {
  kind: "arithmetic", operator: "add", operands: [points, ownTurns, { kind: "constant", value: 1 }]
}];
// @ts-expect-error Player properties cannot read private card contents.
const hiddenCards: PlayerPropertyExpr = { kind: "player-property", property: "hand" };
// @ts-expect-error Runtime object references cannot be used as static players.
const runtimePlayer: PlayerSelector = { ownerOf: { id: "unit", zoneEntryId: 1 } };
export { hiddenCards, runtimePlayer };
