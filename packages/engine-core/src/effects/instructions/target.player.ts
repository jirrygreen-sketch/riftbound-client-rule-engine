import type { Expr, InstructionDef, InstructionResult, PlayerId, ResolveContext, Schema, Value } from "../contract.js";
import { choiceVisibility } from "../interpreter/choice.js";
import {
  evaluatePlayerScopeValue,
  isPlayer,
  trustedPlayerIds
} from "../interpreter/player-scope.js";

/** A player target is a real target, but its identity is a PlayerId value. */
export interface TargetPlayerArgs {
  readonly selection?: Expr;
  readonly chooser?: Expr;
  readonly options?: Expr;
  readonly filter?: Expr;
  readonly scope?: Expr;
  readonly linkKey?: Expr;
  readonly choiceId?: Expr;
  readonly visibility?: Expr;
  readonly prompt?: Expr;
}

const ARG_KEYS = new Set(["selection", "chooser", "options", "filter", "scope", "linkKey", "choiceId", "visibility", "prompt"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === "string";
}

function isValue(value: unknown, active = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || active.has(value)) return false;
  active.add(value);
  const valid = Array.isArray(value)
    ? value.every(item => isValue(item, active))
    : Object.values(value).every(item => isValue(item, active));
  active.delete(value);
  return valid;
}

function id(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseArgs(value: unknown): TargetPlayerArgs {
  if (!isRecord(value)) throw new TypeError("target.player args must be an object");
  for (const key of Object.keys(value)) {
    if (!ARG_KEYS.has(key)) throw new TypeError(`Invalid target.player argument: ${key}`);
    if (value[key] !== undefined && !isExpr(value[key]) && !isValue(value[key])) {
      throw new TypeError(`target.player ${key} must be an Expr`);
    }
  }
  return value as unknown as TargetPlayerArgs;
}

const argsSchema: Schema<TargetPlayerArgs> = {
  parse: parseArgs,
  safeParse(value: unknown) {
    try {
      return { success: true as const, data: parseArgs(value) };
    } catch (error) {
      return { success: false as const, error };
    }
  }
};

function impossible(): InstructionResult {
  return { status: "negated", reason: "impossible", events: [] };
}

function valueAsIds(
  context: ResolveContext,
  expression: Expr | undefined,
  trusted: readonly PlayerId[],
  chooser: PlayerId
): PlayerId[] | null {
  if (expression === undefined) return [...trusted];
  const value = evaluatePlayerScopeValue(context, expression);
  if (value === "dynamic:players" || value === "dynamic:all-players") return [...trusted];
  if (value === "dynamic:opponent-players" || value === "dynamic:opponents") {
    return trusted.filter(player => player !== chooser);
  }
  if (!Array.isArray(value) || !value.every(isPlayer)) return null;
  const result: PlayerId[] = [];
  for (const player of value) {
    if (trusted.includes(player) && !result.includes(player)) result.push(player);
  }
  return result;
}

function applyFilter(candidates: readonly PlayerId[], value: Value | undefined, chooser: PlayerId): PlayerId[] | null {
  if (value === undefined || value === null) return [...candidates];
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 0) return [...candidates];
  if (keys.length !== 1 || keys[0] !== "player") return null;
  const wanted = value.player;
  if (wanted === "opponent" || wanted === "other") return candidates.filter(player => player !== chooser);
  if (wanted === "controller" || wanted === "self" || wanted === "you") {
    return candidates.filter(player => player === chooser);
  }
  if (isPlayer(wanted)) return candidates.includes(wanted) ? [wanted] : [];
  return null;
}

const definition = {
  op: "target.player",
  argsSchema,
  execute(context: ResolveContext, args: TargetPlayerArgs): InstructionResult {
    const trusted = trustedPlayerIds(context);
    const chooserValue = evaluatePlayerScopeValue(context, args.chooser);
    const chooser = chooserValue === undefined || chooserValue === "controller" || chooserValue === "self" || chooserValue === "you"
      ? context.controller
      : chooserValue;
    if (!isPlayer(chooser) || !trusted.includes(chooser)) return impossible();

    const selection = evaluatePlayerScopeValue(context, args.selection);
    if (selection !== undefined && selection !== "one") return impossible();
    const candidates = valueAsIds(context, args.options, trusted, chooser);
    if (candidates === null) return impossible();
    const filterValue = evaluatePlayerScopeValue(context, args.filter);
    const scopeValue = evaluatePlayerScopeValue(context, args.scope);
    const scopedFilter = scopeValue === undefined ? filterValue :
      scopeValue === "opponent" || scopeValue === "other" ? { player: "opponent" } :
        scopeValue === "player" || scopeValue === "any" ? filterValue : null;
    if (scopedFilter === null) return impossible();
    const filtered = applyFilter(candidates, scopedFilter, chooser);
    if (filtered === null) return impossible();
    // A target with no legal player is a mistargeted/empty branch. It must not
    // invent a PlayerId or silently choose the controller.
    if (filtered.length === 0) return { status: "ignored", reason: "mistargeted" };

    const linkKeyValue = evaluatePlayerScopeValue(context, args.linkKey);
    const choiceIdValue = evaluatePlayerScopeValue(context, args.choiceId);
    const visibilityValue = evaluatePlayerScopeValue(context, args.visibility);
    const promptValue = evaluatePlayerScopeValue(context, args.prompt);
    if (linkKeyValue !== undefined && !id(linkKeyValue)) return impossible();
    if (choiceIdValue !== undefined && !id(choiceIdValue)) return impossible();
    if (promptValue !== undefined && !id(promptValue)) return impossible();
    let visibility;
    try {
      visibility = choiceVisibility(visibilityValue);
    } catch {
      return impossible();
    }
    const answer = context.choose<PlayerId>({
      id: choiceIdValue ?? "player",
      type: "mode",
      options: filtered,
      chooser,
      visibility,
      ...(promptValue === undefined ? {} : { prompt: promptValue })
    });
    if (!isPlayer(answer) || !filtered.includes(answer)) return impossible();

    const linkKey = linkKeyValue ?? "chosenPlayer";
    context.link(linkKey, answer);
    // Keep responsibility explicit beside the PlayerId result. Consumers that
    // only need the chosen seat keep the scalar link; consumers that audit
    // attribution can read the stable companion binding.
    context.link(`${linkKey}.responsiblePlayerId`, chooser);
    return {
      status: "executed",
      events: [],
      linkedValues: {
        [linkKey]: answer,
        [`${linkKey}.responsiblePlayerId`]: chooser
      }
    };
  }
} satisfies InstructionDef<TargetPlayerArgs>;

export default definition;
