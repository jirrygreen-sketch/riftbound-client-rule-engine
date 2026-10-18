import type {
  ChoiceVisibility, Expr, InstructionDef, InstructionResult, ObjectFilter,
  ObjectRef, ResolveContext, Schema, Value
} from "../contract.js";
import { choiceVisibility } from "../interpreter/choice.js";
import {
  evaluatePlayerScopeValue,
  isObjectRef,
  isPlayer,
  refKey,
  resolvePlayerScope,
  type PlayerScopeMode
} from "../interpreter/player-scope.js";
import { matchesObjectPredicates } from "../filters/predicates.js";

/**
 * Resolve one choice for each real seat in the selected player scope. The
 * choice is a Pick: selected objects never enter ctx.targets and never emit a
 * became-target event (CR v1.5 355.10.e).
 */
export interface EachPlayerArgs {
  readonly choosers?: Expr;
  readonly choose?: Expr;
  readonly modes?: Expr;
  readonly currentTurnPlayer?: Expr;
  readonly startingWith?: Expr;
  readonly resultKey?: Expr;
  readonly setKey?: Expr;
  readonly optional?: Expr;
  readonly different?: Expr;
  readonly visibility?: Expr;
  readonly prompt?: Expr;
  /** Accepted as structural data and rejected unless a choice spec exists. */
  readonly token?: Expr;
  readonly mode?: Expr;
  readonly location?: Expr;
  readonly entersExhausted?: Expr;
}

const ARG_KEYS = new Set([
  "choosers", "choose", "modes", "currentTurnPlayer", "startingWith", "resultKey", "setKey",
  "optional", "different", "visibility", "prompt", "token", "mode", "location", "entersExhausted"
]);

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

function parseArgs(value: unknown): EachPlayerArgs {
  if (!isRecord(value)) throw new TypeError("choice.each-player args must be an object");
  for (const key of Object.keys(value)) {
    if (!ARG_KEYS.has(key)) throw new TypeError(`Invalid choice.each-player argument: ${key}`);
    if (value[key] !== undefined && !isExpr(value[key]) && !isValue(value[key])) {
      throw new TypeError(`choice.each-player ${key} must be an Expr`);
    }
  }
  return value as unknown as EachPlayerArgs;
}

export const argsSchema: Schema<EachPlayerArgs> = {
  parse: parseArgs,
  safeParse(value: unknown) {
    try {
      return { success: true as const, data: parseArgs(value) };
    } catch (error) {
      return { success: false as const, error };
    }
  }
};

type ModeSpec = { readonly kind: "mode"; readonly options: readonly Value[] };
type ObjectSpec = {
  readonly kind: "objects";
  readonly filter: Readonly<Record<string, Value>>;
  readonly count: number;
  readonly min: number;
  readonly excluded: readonly ObjectRef[];
};
type ParsedSpec = ModeSpec | ObjectSpec;

function literal(value: Value | undefined): Value | undefined {
  return value;
}

function integer(value: Value | undefined, fallback: number): number | null {
  const resolved = value === undefined ? fallback : value;
  return typeof resolved === "number" && Number.isSafeInteger(resolved) && resolved >= 0 ? resolved : null;
}

function asValueRecord(value: unknown): Readonly<Record<string, Value>> | null {
  if (!isRecord(value)) return null;
  for (const entry of Object.values(value)) {
    if (!isJsonValue(entry)) return null;
  }
  return value as Readonly<Record<string, Value>>;
}

function isJsonValue(value: unknown, active = new Set<unknown>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || active.has(value)) return false;
  active.add(value);
  const valid = Array.isArray(value)
    ? value.every(item => isJsonValue(item, active))
    : Object.values(value).every(item => isJsonValue(item, active));
  active.delete(value);
  return valid;
}

function refsFromValue(value: unknown): ObjectRef[] {
  const values = Array.isArray(value) ? value : [value];
  const refs: ObjectRef[] = [];
  for (const item of values) {
    if (!isObjectRef(item) || refs.some(existing => refKey(existing) === refKey(item))) continue;
    refs.push({ id: item.id, zoneEntryId: item.zoneEntryId });
  }
  return refs;
}

function parseModes(value: Value | undefined): ModeSpec | null {
  if (!Array.isArray(value)) return null;
  const options: Value[] = [];
  for (const entry of value) {
    if (isRecord(entry) && id(entry.id)) options.push(entry.id);
    else if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") options.push(entry);
    else return null;
  }
  if (options.length === 0) return null;
  return { kind: "mode", options };
}

function parseSpec(value: Value | undefined): ParsedSpec | null {
  if (Array.isArray(value)) return parseModes(value);
  const record = asValueRecord(value);
  if (record === null) return null;
  if (Array.isArray(record.options)) {
    const mode = parseModes(record.options);
    if (mode === null) return null;
    return mode;
  }
  const filter = record.filter === undefined ? record : asValueRecord(record.filter);
  if (filter === null) return null;
  const count = integer(record.count, 1);
  const min = integer(record.min, count ?? 0);
  if (count === null || min === null || min > count) return null;
  const excluded = refsFromValue(record.exclude ?? record.notChosen);
  return { kind: "objects", filter, count, min, excluded };
}

function relativeFilter(filter: Readonly<Record<string, Value>>, seat: string, abilityController: string): {
  readonly filter: Readonly<Record<string, Value>>;
  readonly predicate: (snapshot: Parameters<ResolveContext["query"]>[0] extends never ? never : any) => boolean;
} {
  const copy: Record<string, Value> = { ...filter };
  const expected = copy.controller;
  delete copy.notChosenForThisSpell;
  delete copy.notChosen;
  if (expected === "controller" || expected === "self" || expected === "you") copy.controller = seat;
  // ObjectFilter's opponent spelling is relative to the ability controller in
  // the shared matcher. A local predicate keeps the per-player meaning exact.
  const opposing = expected === "opponent" || expected === "other";
  if (opposing) delete copy.controller;
  return {
    filter: copy,
    predicate: (snapshot: any) => !opposing || snapshot.controller !== abilityController
  };
}

function candidatesFor(context: ResolveContext, spec: ObjectSpec, seat: string): ObjectRef[] {
  const normalized = relativeFilter(spec.filter, seat, context.controller);
  const raw = context.query({});
  const result: ObjectRef[] = [];
  for (const snapshot of raw) {
    if (!normalized.predicate(snapshot)) continue;
    if (!matchesObjectPredicates(normalized.filter as ObjectFilter, snapshot, {
      controller: seat,
      anchor: context.source,
      references: selector => {
        if (selector === "source" || selector === "self") return [context.source];
        return [];
      }
    })) continue;
    // A player may choose a hidden card only from their own private zone.
    if (snapshot.zone === "hand" && snapshot.owner !== seat) continue;
    if (spec.excluded.some(ref => refKey(ref) === refKey(snapshot.ref))) continue;
    if (result.some(ref => refKey(ref) === refKey(snapshot.ref))) continue;
    result.push(snapshot.ref);
  }
  return result;
}

function choiceOptions(value: Value | undefined, modes: Value | undefined): ParsedSpec | null {
  return parseSpec(value ?? modes);
}

function modeValue(value: Value): string | number | boolean {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new TypeError("choice.each-player mode answer must be a scalar option");
}

function resultValue(entries: readonly {
  readonly player: string;
  readonly chooser: string;
  readonly responsiblePlayerId: string;
  readonly choices: readonly Value[];
  readonly objects: readonly ObjectRef[];
  readonly declined: boolean;
}[]): Value {
  const output: Record<string, Value> = {};
  for (const entry of entries) {
    output[entry.player] = {
      player: entry.player,
      chooser: entry.chooser,
      responsiblePlayerId: entry.responsiblePlayerId,
      choices: entry.choices,
      objects: entry.objects.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId })),
      declined: entry.declined
    };
  }
  return output;
}

function impossible(): InstructionResult {
  return { status: "negated", reason: "impossible", events: [] };
}

export function executeEachPlayer(context: ResolveContext, args: EachPlayerArgs, forcedMode?: PlayerScopeMode): InstructionResult {
  const evaluate = (expr: Expr | undefined): Value | undefined => evaluatePlayerScopeValue(context, expr);
  const modeValueRaw = forcedMode ?? (args.choosers === undefined ? "each-player" : evaluate(args.choosers));
  if (modeValueRaw !== "each-player" && modeValueRaw !== "each-other-player" && modeValueRaw !== "controller-and-each-opponent") return impossible();
  const turnPlayer = evaluate(args.currentTurnPlayer);
  if (turnPlayer !== undefined && !isPlayer(turnPlayer)) return impossible();
  const startingWithValue = evaluate(args.startingWith);
  if (startingWithValue !== undefined && startingWithValue !== "current-player" &&
    startingWithValue !== "next-player" && !isPlayer(startingWithValue)) return impossible();
  const optional = evaluate(args.optional);
  if (optional !== undefined && typeof optional !== "boolean") return impossible();
  const resultKey = evaluate(args.resultKey);
  const setKey = evaluate(args.setKey);
  if (resultKey !== undefined && !id(resultKey)) return impossible();
  if (setKey !== undefined && !id(setKey)) return impossible();
  const prompt = evaluate(args.prompt);
  if (prompt !== undefined && !id(prompt)) return impossible();
  let visibility: ChoiceVisibility = "chooser-only";
  try {
    visibility = choiceVisibility(evaluate(args.visibility));
  } catch {
    return impossible();
  }

  const modes = evaluate(args.modes);
  const spec = choiceOptions(evaluate(args.choose), modes);
  if (spec === null) return impossible();
  const scope = resolvePlayerScope(context, {
    mode: modeValueRaw,
    startingWith: startingWithValue as "current-player" | "next-player" | string | undefined,
    turnPlayerId: turnPlayer as string | undefined
  });
  if (scope.length === 0) {
    const empty: Value = {};
    if (resultKey !== undefined) context.link(resultKey, empty);
    return { status: "executed", events: [], linkedValues: { [resultKey ?? "choices"]: empty } };
  }

  const receipt: {
    readonly player: string;
    readonly chooser: string;
    readonly responsiblePlayerId: string;
    readonly choices: Value[];
    readonly objects: ObjectRef[];
    readonly declined: boolean;
  }[] = [];
  const allObjects: ObjectRef[] = [];
  for (const seat of scope) {
    const choices: Value[] = [];
    const selectedObjects: ObjectRef[] = [];
    if (spec.kind === "mode") {
      const options = [...spec.options];
      if (options.length === 0) return impossible();
      const choiceOptions = optional === true ? [...options, "decline"] : options;
      const answer = context.choose<Value>({
        id: `${resultKey ?? "choices"}:${seat.playerId}:mode`,
        type: "mode",
        options: choiceOptions,
        chooser: seat.chooser,
        visibility,
        ...(prompt === undefined ? {} : { prompt })
      });
      if (answer === "decline") {
        if (optional !== true) return impossible();
        choices.push(null);
      } else if (!choiceOptions.some(option => JSON.stringify(option) === JSON.stringify(answer))) {
        return impossible();
      } else {
        choices.push(modeValue(answer));
      }
    } else {
      const candidates = candidatesFor(context, spec, seat.playerId);
      if (candidates.length === 0) {
        // “Do as much as you can” and empty-player branches are explicit: the
        // seat remains in the receipt with no object, without a fake choice.
        choices.push([]);
      } else {
        if (spec.count > candidates.length) return impossible();
        const min = optional === true ? Math.min(spec.min, spec.count) : spec.min;
        const answer = context.choose<readonly ObjectRef[]>({
          id: `${resultKey ?? "choices"}:${seat.playerId}:objects`,
          type: "select-objects",
          options: candidates,
          min,
          max: spec.count,
          chooser: seat.chooser,
          visibility,
          ...(prompt === undefined ? {} : { prompt })
        });
        if (!Array.isArray(answer) || answer.length < min || answer.length > spec.count) return impossible();
        const seen = new Set<string>();
        for (const value of answer) {
          if (!isObjectRef(value) || !candidates.some(candidate => refKey(candidate) === refKey(value)) || seen.has(refKey(value))) return impossible();
          seen.add(refKey(value));
          selectedObjects.push({ id: value.id, zoneEntryId: value.zoneEntryId });
        }
        choices.push(selectedObjects.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId })));
      }
    }
    allObjects.push(...selectedObjects);
    receipt.push({
      player: seat.playerId,
      chooser: seat.chooser,
      responsiblePlayerId: seat.responsiblePlayerId,
      choices,
      objects: selectedObjects,
      declined: optional === true && selectedObjects.length === 0 && choices.some(choice => choice === null || (Array.isArray(choice) && choice.length === 0))
    });
  }

  const key = resultKey ?? "choices";
  const links: Record<string, Value> = { [key]: resultValue(receipt) };
  context.link(key, links[key]!);
  if (setKey !== undefined) {
    const refs = allObjects.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
    links[setKey] = refs;
    context.link(setKey, refs);
  }
  return { status: "executed", events: [], linkedValues: links };
}

const definition = {
  op: "choice.each-player",
  argsSchema,
  execute(context: ResolveContext, args: EachPlayerArgs): InstructionResult {
    return executeEachPlayer(context, args);
  }
} satisfies InstructionDef<EachPlayerArgs>;

export default definition;
