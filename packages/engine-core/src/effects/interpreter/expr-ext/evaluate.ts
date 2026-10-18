import type { Expr, ObjectSelector, PlayerSelector } from "@riftbound/card-dsl";
import type { ObjectSnapshot, PlayerId, Value } from "../../contract.js";
import { evaluateExpression, type ExpressionContext } from "../expr.js";
import { resolveObjectSelector, selectorSnapshot } from "../selectors.js";
import { arithmetic, MissingInformation } from "../values.js";

function selectedObject(selector: ObjectSelector, environment: ExpressionContext): ObjectSnapshot {
  const refs = resolveObjectSelector(selector, environment);
  if (refs.length !== 1) throw new MissingInformation("A player or designation expression requires exactly one object");
  return selectorSnapshot(refs[0]!, environment, selector === "source");
}

/** Resolve one player through existing read capabilities, preserving zone identity. */
export function resolvePlayerSelector(selector: PlayerSelector = "controller", environment: ExpressionContext): PlayerId {
  if (selector === "controller") return environment.context.controller;
  if (selector === null || typeof selector !== "object" || Array.isArray(selector) || Object.keys(selector).length !== 1) {
    throw new Error("Invalid PlayerSelector");
  }
  if ("id" in selector) {
    if (typeof selector.id !== "string" || selector.id.trim().length === 0) throw new Error("Invalid player id");
    return selector.id;
  }
  if ("controllerOf" in selector) return selectedObject(selector.controllerOf, environment).controller;
  if ("ownerOf" in selector) return selectedObject(selector.ownerOf, environment).owner;
  if ("pick" in selector) {
    if (typeof selector.pick !== "string" || selector.pick.trim().length === 0) throw new Error("Invalid player pick id");
    const picks = environment.context.picks(selector.pick);
    if (picks.length !== 1 || typeof picks[0] !== "string") throw new MissingInformation("A player selector requires exactly one player pick");
    // Picks can also contain modes/strings. Only an authoritative player lookup
    // can confirm that the selected string names a player.
    return environment.context.player(picks[0]).id;
  }
  throw new Error("Invalid PlayerSelector");
}

function count(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MissingInformation(`Unavailable or invalid ${label}`);
  }
  return value;
}

/**
 * Shared read-only leaves used by the main dispatcher and the public extension
 * entry point. Arithmetic composes through the same production evaluator.
 * No state, derived values or player identities are cached between calls.
 */
export function evaluateExtendedExpression(expr: Expr, environment: ExpressionContext): Value {
  const context = environment.context;
  switch (expr.kind) {
    case "player-property": {
      const id = resolvePlayerSelector(expr.player, environment);
      const player = context.player(id);
      if (expr.property === "trashSize" || expr.property === "trashCount") {
        return context.zoneSlice(id, "trash", "top").length;
      }
      const property = expr.property === "points" ? "score" : expr.property;
      if (!Object.hasOwn(player, property)) throw new MissingInformation(`Unavailable player property: ${property}`);
      return count(player[property], `player property: ${property}`);
    }
    case "turn-number":
      return count(context.history({ scope: "game", timingPoint: "turn-start" }), "global turn history");
    case "player-turn-count": {
      const player = resolvePlayerSelector(expr.player, environment);
      context.player(player);
      return count(context.history({ scope: "game", timingPoint: "turn-start", player }), "player turn history");
    }
    case "object-designation":
      return selectedObject(expr.object, environment).combatRole ?? null;
    case "count":
      if (expr.subject === "controller-xp") {
        const filter = expr.filter ?? {};
        if (Object.keys(filter).some(key => key !== "player") || filter.player !== undefined && filter.player !== "controller") {
          throw new MissingInformation("Unsupported controller XP filter");
        }
        return evaluateExtendedExpression({ kind: "player-property", property: "xp" }, environment);
      }
      if (expr.subject === "self-in-combat") {
        const filter = expr.filter ?? {};
        if (Object.keys(filter).some(key => key !== "object") || filter.object !== undefined && filter.object !== "self") {
          throw new MissingInformation("Unsupported combat designation filter");
        }
        const role = selectedObject("self", environment).combatRole;
        return role === "attacker" || role === "defender" ? 1 : 0;
      }
      return evaluateExpression(expr, environment);
    case "object-property":
    case "object-attribute": {
      const property = expr.kind === "object-property" ? expr.property : expr.attribute;
      if (property === "designation") return selectedObject(expr.object, environment).combatRole ?? null;
      return evaluateExpression(expr, environment);
    }
    case "arithmetic":
      return arithmetic(expr.operator, expr.operands.map(operand => evaluateExtendedExpression(operand, environment)));
    default:
      return evaluateExpression(expr, environment);
  }
}
