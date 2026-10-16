import type { Expr } from "@riftbound/card-dsl";
import type {
  ChoiceRequest,
  ChoiceVisibility,
  GameAction,
  GameEvent,
  InstructionDef,
  ObjectRef,
  PlayerId,
  Value
} from "../contract.js";

/**
 * Repeat performs the already-resolved spell effect again during resolution.
 *
 * `actions` contains the effect body as one or more closed `GameAction`
 * templates. Dynamic fields are supplied as card-dsl `Expr` values. A target
 * field is bound with `targets: { field: targetSpecId }`, which resolves a
 * fresh `ctx.targets(targetSpecId)` set for every additional execution. A
 * non-target field can instead read `ctx.picks(pickSpecId)` with
 * `picks: { field: pickSpecId }`, or be filled by `choices` and `ctx.choose`.
 * `count` is the number of paid Repeat instances and therefore the number of
 * additional executions; it defaults to one and may be zero.
 *
 * This follows Core Rules v1.5 820.1.b-d, 820.2, 820.2.a, and 820.3: Repeat
 * executes the effect again during resolution, re-makes choices, and does not
 * play the spell again. Re-selecting a target is part of the repeated effect;
 * re-selecting a target and repeating the effect are separate concepts.
 */

const GAME_ACTION_TYPES = [
  "draw",
  "discard",
  "move-zone",
  "recycle",
  "banish",
  "mill",
  "shuffle",
  "order-top",
  "return-to-hand",
  "move-location",
  "ready",
  "exhaust",
  "stun",
  "kill",
  "attach",
  "detach",
  "take-control",
  "damage",
  "heal",
  "channel-rune",
  "gain-energy",
  "gain-power",
  "pay",
  "gain-xp",
  "spend-xp",
  "buff",
  "spend-buff",
  "empower",
  "disempower",
  "add-counter",
  "remove-counter",
  "create-token",
  "copy",
  "play",
  "reveal",
  "look",
  "show-off",
  "counter",
  "score",
  "win"
] as const satisfies readonly GameAction["type"][];

type RepeatActionType = (typeof GAME_ACTION_TYPES)[number];
type ExprOrValue = Expr | Value;

export interface RepeatActionSpec {
  readonly type: RepeatActionType;
  readonly values?: Readonly<Record<string, Expr>>;
  readonly targets?: Readonly<Record<string, string>>;
  readonly picks?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

export interface RepeatChoiceSpec {
  readonly id: string;
  readonly field: string;
  readonly type: "optional" | "mode" | "number";
  readonly options?: readonly ExprOrValue[];
  readonly min?: ExprOrValue;
  readonly max?: ExprOrValue;
  readonly chooser?: PlayerId;
  readonly visibility?: ChoiceVisibility;
}

export interface RepeatArgs {
  readonly actions?: readonly RepeatActionSpec[];
  readonly action?: RepeatActionSpec;
  readonly effect?: RepeatActionSpec | readonly RepeatActionSpec[];
  readonly count?: Expr;
  readonly repetitions?: Expr;
  readonly times?: Expr;
  readonly choices?: readonly RepeatChoiceSpec[];
  readonly choice?: RepeatChoiceSpec;
  readonly linkKey?: string;
  readonly resultKey?: string;
}

interface NormalizedRepeatArgs {
  readonly actions: readonly RepeatActionSpec[];
  readonly count: Expr;
  readonly choices: readonly RepeatChoiceSpec[];
  readonly linkKey?: string;
}

const ACTION_FIELDS = new Set([
  "player",
  "amount",
  "object",
  "objects",
  "to",
  "location",
  "zone",
  "source",
  "target",
  "combat",
  "host",
  "power",
  "plan",
  "counter",
  "multiple",
  "limit",
  "token",
  "viewers",
  "properties",
  "exhausted"
]);

const RESERVED_ACTION_FIELDS = new Set(["type", "values", "targets", "picks", "targetSpec", "objectSpec", "objectsSpec", "sourceSpec", "hostSpec", "pickSpec"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  return value.kind === "constant" || value.kind === "literal" || value.kind === "object-property" || value.kind === "object-attribute" || value.kind === "linked-value" || value.kind === "linked" || value.kind === "count";
}

function assertExpr(value: unknown, path: string): asserts value is Expr {
  if (!isExpr(value)) throw new TypeError(`${path} must be a card-dsl Expr`);
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${path} must be a non-empty string`);
}

function parseAction(value: unknown, index: number): RepeatActionSpec {
  if (!isRecord(value)) throw new TypeError(`actions[${index}] must be an object`);
  const type = value.type;
  if (typeof type !== "string" || !GAME_ACTION_TYPES.includes(type as RepeatActionType)) {
    throw new TypeError(`actions[${index}].type must be a closed GameAction type`);
  }

  const values: Record<string, Expr> = {};
  if (value.values !== undefined) {
    if (!isRecord(value.values)) throw new TypeError(`actions[${index}].values must be an object`);
    for (const [field, expression] of Object.entries(value.values)) {
      assertExpr(expression, `actions[${index}].values.${field}`);
      values[field] = expression;
    }
  }
  for (const [field, candidate] of Object.entries(value)) {
    if (!ACTION_FIELDS.has(field) || RESERVED_ACTION_FIELDS.has(field) || field in values) continue;
    if (candidate !== undefined) {
      assertExpr(candidate, `actions[${index}].${field}`);
      values[field] = candidate;
    }
  }

  const targets: Record<string, string> = {};
  if (value.targets !== undefined) {
    if (!isRecord(value.targets)) throw new TypeError(`actions[${index}].targets must be an object`);
    for (const [field, specId] of Object.entries(value.targets)) {
      assertString(specId, `actions[${index}].targets.${field}`);
      targets[field] = specId;
    }
  }
  const shorthandTargets: Record<string, string> = {
    object: "objectSpec",
    objects: "objectsSpec",
    source: "sourceSpec",
    target: "targetSpec",
    host: "hostSpec"
  };
  for (const [field, key] of Object.entries(shorthandTargets)) {
    if (targets[field] !== undefined || value[key] === undefined) continue;
    assertString(value[key], `actions[${index}].${key}`);
    targets[field] = value[key];
  }

  const picks: Record<string, string> = {};
  if (value.picks !== undefined) {
    if (!isRecord(value.picks)) throw new TypeError(`actions[${index}].picks must be an object`);
    for (const [field, specId] of Object.entries(value.picks)) {
      assertString(specId, `actions[${index}].picks.${field}`);
      picks[field] = specId;
    }
  }
  if (value.pickSpec !== undefined) {
    assertString(value.pickSpec, `actions[${index}].pickSpec`);
    const field = type === "order-top" || type === "look" ? "objects" : "player";
    if (picks[field] === undefined) picks[field] = value.pickSpec;
  }

  return {
    type: type as RepeatActionType,
    ...(Object.keys(values).length > 0 ? { values } : {}),
    ...(Object.keys(targets).length > 0 ? { targets } : {}),
    ...(Object.keys(picks).length > 0 ? { picks } : {})
  };
}

function parseChoice(value: unknown, path: string): RepeatChoiceSpec {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  assertString(value.id, `${path}.id`);
  assertString(value.field ?? value.key ?? value.id, `${path}.field`);
  const type = value.type ?? "mode";
  if (type !== "optional" && type !== "mode" && type !== "number") throw new TypeError(`${path}.type must be optional, mode, or number`);
  const options = value.options;
  if (type === "mode") {
    if (!Array.isArray(options) || options.length === 0) throw new TypeError(`${path}.options must be a non-empty array for a mode choice`);
    for (const [index, option] of options.entries()) {
      if (!isExpr(option) && (typeof option !== "string" && typeof option !== "number" && typeof option !== "boolean" && option !== null && !Array.isArray(option) && !isRecord(option))) {
        throw new TypeError(`${path}.options[${index}] must be an Expr or card-dsl Value`);
      }
    }
  }
  if (type === "number") {
    assertExpr(value.min, `${path}.min`);
    assertExpr(value.max, `${path}.max`);
  }
  if (value.chooser !== undefined) assertString(value.chooser, `${path}.chooser`);
  if (value.visibility !== undefined && value.visibility !== "public" && value.visibility !== "chooser-only" && !Array.isArray(value.visibility)) {
    throw new TypeError(`${path}.visibility must be a valid choice visibility`);
  }
  return {
    id: value.id,
    field: value.field ?? value.key ?? value.id,
    type,
    ...(options === undefined ? {} : { options }),
    ...(value.min === undefined ? {} : { min: value.min }),
    ...(value.max === undefined ? {} : { max: value.max }),
    ...(value.chooser === undefined ? {} : { chooser: value.chooser }),
    ...(value.visibility === undefined ? {} : { visibility: value.visibility })
  } as RepeatChoiceSpec;
}

function parseRepeatArgs(value: unknown): NormalizedRepeatArgs {
  if (!isRecord(value)) throw new TypeError("effect.repeat arguments must be an object");
  const rawActions = value.actions ?? value.action ?? value.effect;
  const actionValues = Array.isArray(rawActions) ? rawActions : rawActions === undefined ? [] : [rawActions];
  if (actionValues.length === 0) throw new TypeError("effect.repeat requires at least one action template");
  const actions = actionValues.map((action, index) => parseAction(action, index));

  const count = value.count ?? value.repetitions ?? value.times ?? { kind: "constant", value: 1 };
  assertExpr(count, "count");

  const rawChoices = value.choices ?? value.choice;
  const choiceValues = Array.isArray(rawChoices) ? rawChoices : rawChoices === undefined ? [] : [rawChoices];
  const choices = choiceValues.map((choice, index) => parseChoice(choice, `choices[${index}]`));

  const linkKey = value.linkKey ?? value.resultKey;
  if (linkKey !== undefined) assertString(linkKey, "linkKey");
  return { actions, count, choices, ...(linkKey === undefined ? {} : { linkKey }) };
}

function evaluateValue(ctx: Parameters<InstructionDef<RepeatArgs>["execute"]>[0], value: ExprOrValue): Value {
  return isExpr(value) ? ctx.evaluate(value) : value;
}

function evaluateInteger(ctx: Parameters<InstructionDef<RepeatArgs>["execute"]>[0], value: Expr, path: string): number {
  const result = ctx.evaluate(value);
  if (typeof result !== "number" || !Number.isInteger(result) || !Number.isFinite(result)) throw new TypeError(`${path} must evaluate to a finite integer`);
  return result;
}

function choiceRequest(ctx: Parameters<InstructionDef<RepeatArgs>["execute"]>[0], choice: RepeatChoiceSpec): ChoiceRequest<unknown> {
  const base = {
    id: choice.id,
    chooser: choice.chooser ?? ctx.controller,
    visibility: choice.visibility ?? "public"
  } as const;
  if (choice.type === "optional") return { ...base, type: "optional" };
  if (choice.type === "mode") {
    return { ...base, type: "mode", options: (choice.options ?? []).map(option => evaluateValue(ctx, option)) };
  }
  return {
    ...base,
    type: "number",
    min: evaluateInteger(ctx, choice.min as Expr, `${choice.id}.min`),
    max: evaluateInteger(ctx, choice.max as Expr, `${choice.id}.max`)
  };
}

function resolveChoiceFields(ctx: Parameters<InstructionDef<RepeatArgs>["execute"]>[0], choices: readonly RepeatChoiceSpec[]): Record<string, Value> {
  const fields: Record<string, Value> = {};
  for (const choice of choices) fields[choice.field] = ctx.choose(choiceRequest(ctx, choice)) as Value;
  return fields;
}

function targetRefs(ctx: Parameters<InstructionDef<RepeatArgs>["execute"]>[0], specId: string): ObjectRef[] {
  return ctx.targets(specId).filter(ref => ctx.object(ref) !== null);
}

function resolveActionInstances(
  ctx: Parameters<InstructionDef<RepeatArgs>["execute"]>[0],
  actionSpec: RepeatActionSpec,
  choiceFields: Readonly<Record<string, Value>>
): GameAction[] {
  const fields: Record<string, unknown> = {};
  for (const [field, expression] of Object.entries(actionSpec.values ?? {})) fields[field] = ctx.evaluate(expression);
  Object.assign(fields, choiceFields);
  for (const [field, specId] of Object.entries(actionSpec.picks ?? {})) {
    const picks = ctx.picks(specId);
    fields[field] = field === "objects" || field === "power" || field === "viewers" || picks.length !== 1 ? [...picks] : picks[0];
  }

  const targetEntries = Object.entries(actionSpec.targets ?? {});
  if (targetEntries.length === 0) return [{ type: actionSpec.type, ...fields } as unknown as GameAction];

  let instances: Record<string, unknown>[] = [{}];
  for (const [field, specId] of targetEntries) {
    const refs = targetRefs(ctx, specId);
    if (refs.length === 0) return [];
    if (field === "objects") {
      instances = instances.map(instance => ({ ...instance, [field]: refs }));
    } else {
      instances = instances.flatMap(instance => refs.map(ref => ({ ...instance, [field]: ref })));
    }
  }
  return instances.map(instance => ({ type: actionSpec.type, ...fields, ...instance } as unknown as GameAction));
}

function actualResult(results: readonly Value[]): Value {
  if (results.length === 0) return 0;
  if (results.every(result => typeof result === "number")) return results.reduce((total, result) => total + Number(result), 0);
  return results.length === 1 ? results[0]! : results;
}

const repeat = {
  op: "effect.repeat",
  argsSchema: { parse: value => parseRepeatArgs(value) as unknown as RepeatArgs },
  execute(ctx, rawArgs) {
    const args = parseRepeatArgs(rawArgs);
    const count = evaluateInteger(ctx, args.count, "count");
    if (count < 0) throw new RangeError("count must be non-negative");

    const events: GameEvent[] = [];
    const results: Value[] = [];
    let performed = 0;
    for (let iteration = 0; iteration < count; iteration += 1) {
      const choiceFields = resolveChoiceFields(ctx, args.choices);
      for (const actionSpec of args.actions) {
        const actions = resolveActionInstances(ctx, actionSpec, choiceFields);
        if (actions.length === 0) {
          if (performed === 0) return { status: "ignored", reason: "mistargeted" };
          continue;
        }
        for (const action of actions) {
          const outcome = ctx.perform(action);
          events.push(...outcome.events);
          if (outcome.status !== "done") {
            return {
              status: "negated",
              reason: outcome.status === "replaced" ? "replaced" : "impossible",
              events
            };
          }
          performed += 1;
          results.push(outcome.result ?? null);
        }
      }
    }

    const actual = actualResult(results);
    const linkedValues: Record<string, Value> = {
      repeats: count,
      performed,
      results,
      result: actual,
      actual
    };
    if (args.linkKey) linkedValues[args.linkKey] = actual;
    for (const [key, value] of Object.entries(linkedValues)) ctx.link(key, value);
    return { status: "executed", events, linkedValues };
  }
} satisfies InstructionDef<RepeatArgs>;

export default repeat;
