/**
 * Copy game objects through the frozen action boundary (Core Rules v1.5).
 *
 * Every argument is an Expr. source evaluates to a symbolic ObjectSelector:
 * self/source, { target: id }, { pick: id }, or { linked: key }. Targets are
 * read only through ctx.targets; picks and linked references are not targets.
 * Duplicate and stale references are removed without substituting new zone
 * identities. choiceId optionally asks the controller to select ONE source
 * from a pick/linked set; its public, stable choice is transactionally replayed.
 * No query is used to infer zone order or discover a generated object's ref.
 *
 * mode is create (default), play, or effect. create submits the Copy action
 * once per source per amount (a nonnegative safe integer, default 1). player
 * defaults to the ability controller. location must evaluate to a legal
 * LocationRef for a Board permanent; default unit Base placement is its
 * controller's Base (440.2.b.1, 355.2.a). Other object types remain blocked
 * because this action has no matching creation destination. The action owns
 * copied printed traits and new object state: 446.3, 479.1.b.1, 479.1.c. Costs
 * are never derived from the current snapshot or coerced from null to zero.
 *
 * Existing-object copies belong to the copy layer (446.1-2, 479.1.a-d), before
 * trait/ability/arithmetic effects. effect mode reserves onto and duration
 * expressions, but remains blocked: the contract cannot express an attachment
 * lifetime or freeze all copyable text/traits and exceptions independently of
 * the original object's later zone identity. It must not create a new object
 * instead. play mode also remains blocked: Copy has no Chain destination, so
 * Copy-to-Board followed by Play would introduce an incorrect Board entry
 * (185.2.a, 440.2.c). effect.token owns ordinary token definitions; effect.play
 * owns existing playable objects. Neither is a substitute for these paths.
 * Unknown copy exceptions are rejected by the schema, never silently ignored.
 *
 * linkKey defaults to copied. Its receipt records the actual done action
 * amount, returned objects, and corresponding original sources. objectsComplete
 * is false if a successful action omitted its result; no identity is guessed.
 * The amount and objects are also linked as <linkKey>.amount/.objects for IR.
 * Any replaced/prevented/impossible action negates the whole instruction while
 * retaining actual partial results; all invalid targets ignore it (446.4 and
 * P0 3.6 rules 1-3). Unsupported modes link a blockedReason and are negated.
 */
import type {
  Expr, GameEvent, InstructionDef, InstructionResult, LocationRef, ObjectRef,
  ResolveContext, Value
} from "../contract.js";

export interface CopyArgs {
  readonly source: Expr;
  readonly mode?: Expr;
  readonly amount?: Expr;
  readonly player?: Expr;
  readonly location?: Expr;
  readonly choiceId?: Expr;
  readonly onto?: Expr;
  readonly duration?: Expr;
  readonly linkKey?: Expr;
}

type Selector = "self" | "source" |
  { readonly target: string } | { readonly pick: string } | { readonly linked: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValue(value: unknown, active = new Set<object>()): value is Value {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if ((!isRecord(value) && !Array.isArray(value)) || active.has(value)) return false;
  active.add(value);
  const valid = Object.values(value).every(entry => isValue(entry, active));
  active.delete(value);
  return valid;
}

function isSelector(value: unknown): value is Selector {
  return value === "self" || value === "source" || isRecord(value) &&
    Object.keys(value).length === 1 && ["target", "pick", "linked"].some(key => isId(value[key]));
}

function isExpr(value: unknown): value is Expr {
  if (!isRecord(value) || !isValue(value)) return false;
  switch (value.kind) {
    case "constant": case "literal": return Object.hasOwn(value, "value");
    case "object-property": return isSelector(value.object) && isId(value.property);
    case "object-attribute": return isSelector(value.object) && isId(value.attribute);
    case "linked": case "linked-value":
      return isId(value.instructionId) && (value.key === undefined || isId(value.key));
    case "count": return isId(value.subject) && (value.filter === undefined || isRecord(value.filter));
    case "arithmetic": {
      if (!Array.isArray(value.operands) || !value.operands.every(isExpr)) return false;
      switch (value.operator) {
        case "add": case "mul": case "multiply": case "min": case "max": return value.operands.length > 0;
        case "sub": case "subtract": case "div": case "divide": return value.operands.length === 2;
        case "neg": return value.operands.length === 1;
        default: return false;
      }
    }
    default: return false;
  }
}

function parseArgs(value: unknown): CopyArgs {
  if (!isRecord(value) || !Object.hasOwn(value, "source")) throw new TypeError("effect.copy requires a source Expr");
  const keys = ["source", "mode", "amount", "player", "location", "choiceId", "onto", "duration", "linkKey"];
  for (const [key, expression] of Object.entries(value)) {
    if (!keys.includes(key) || !isExpr(expression)) throw new TypeError("Invalid effect.copy argument: " + key);
  }
  return { ...value } as unknown as CopyArgs;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && Number.isSafeInteger(value.zoneEntryId) && Number(value.zoneEntryId) >= 0;
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function currentRefs(ctx: ResolveContext, selector: Selector): ObjectRef[] {
  const values = typeof selector === "string" ? [ctx.source.ref] :
    "target" in selector ? ctx.targets(selector.target) :
      "pick" in selector ? ctx.picks(selector.pick) : ctx.linked(selector.linked);
  const refs: ObjectRef[] = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    if (isRef(value) && ctx.object(value) !== null && !refs.some(ref => sameRef(ref, value))) refs.push(value);
  }
  return refs;
}

function isLocation(value: unknown): value is LocationRef {
  return isRecord(value) && (value.type === "base" && isId(value.player) || value.type === "battlefield" && isId(value.id));
}

export default {
  op: "effect.copy",
  argsSchema: { parse: parseArgs },
  execute(ctx, args): InstructionResult {
    const source = ctx.evaluate(args.source);
    const mode = args.mode === undefined ? "create" : ctx.evaluate(args.mode);
    const amount = args.amount === undefined ? 1 : ctx.evaluate(args.amount);
    const player = args.player === undefined ? ctx.controller : ctx.evaluate(args.player);
    const linkKey = args.linkKey === undefined ? "copied" : ctx.evaluate(args.linkKey);
    const choiceId = args.choiceId === undefined ? undefined : ctx.evaluate(args.choiceId);
    if (!isSelector(source)) throw new TypeError("effect.copy source must be a symbolic ObjectSelector");
    if (mode !== "create" && mode !== "play" && mode !== "effect") throw new TypeError("Invalid effect.copy mode");
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError("effect.copy amount must be a nonnegative safe integer");
    }
    if (!isId(player) || !isId(linkKey) || choiceId !== undefined && !isId(choiceId)) {
      throw new TypeError("effect.copy player, linkKey and choiceId must be nonempty strings");
    }
    if (choiceId !== undefined && (typeof source === "string" || "target" in source)) {
      throw new TypeError("effect.copy choiceId requires a non-target pick or linked source");
    }

    let sources = currentRefs(ctx, source);
    const targetSets = typeof source !== "string" && "target" in source ? [sources] : [];
    if (mode === "effect" && args.onto !== undefined) {
      const onto = ctx.evaluate(args.onto);
      if (!isSelector(onto)) throw new TypeError("effect.copy onto must be a symbolic ObjectSelector");
      if (typeof onto !== "string" && "target" in onto) targetSets.push(currentRefs(ctx, onto));
    }
    if (targetSets.length > 0 && targetSets.every(refs => refs.length === 0)) {
      return { status: "ignored", reason: "mistargeted" };
    }
    const events: GameEvent[] = [];
    const objects: ObjectRef[] = [];
    const originals: ObjectRef[] = [];
    let completed = 0;
    const receipt = (blockedReason?: string): Record<string, Value> => {
      const references = objects.map(ref => ({ ...ref }));
      const value: Value = {
        amount: completed, objects: references, sources: originals.map(ref => ({ ...ref })),
        objectsComplete: objects.length === completed,
        ...(blockedReason === undefined ? {} : { blockedReason })
      };
      const linked = { [linkKey]: value, [linkKey + ".amount"]: completed, [linkKey + ".objects"]: references };
      for (const [key, entry] of Object.entries(linked)) ctx.link(key, entry);
      return linked;
    };
    const negate = (blockedReason?: string): InstructionResult => {
      receipt(blockedReason);
      return { status: "negated", reason: "impossible", events };
    };

    if (mode === "effect") return negate("copy-layer-traits-exceptions-and-attachment-duration-unavailable");
    if (args.onto !== undefined || args.duration !== undefined) return negate("copy-create-cannot-transform-an-existing-object");
    if (mode === "play") return negate("copy-action-cannot-create-a-pending-chain-object");
    const location = args.location === undefined ? null : ctx.evaluate(args.location);
    if (!isLocation(location)) throw new TypeError("effect.copy create requires a location Expr");
    if (amount === 0) return { status: "executed", events, linkedValues: receipt() };
    if (sources.length === 0) return negate();
    if (choiceId !== undefined) {
      sources.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : left.zoneEntryId - right.zoneEntryId);
      const answer = ctx.choose<readonly ObjectRef[]>({
        id: choiceId, type: "select-objects", chooser: ctx.controller, visibility: "public",
        options: sources, min: 1, max: 1
      });
      if (!Array.isArray(answer) || answer.length !== 1 || !isRef(answer[0]) ||
          !sources.some(ref => sameRef(ref, answer[0]!))) throw new TypeError("Invalid effect.copy choice answer");
      sources = [answer[0]];
    }
    if (sources.some(ref => !ctx.object(ref)!.types.some(type => type === "unit" || type === "gear"))) {
      return negate("copy-action-only-supports-board-permanents");
    }
    if (location.type === "base" && location.player !== player && sources.some(ref => ctx.object(ref)!.types.includes("unit"))) {
      return negate();
    }
    if (!Number.isSafeInteger(amount * sources.length)) throw new TypeError("effect.copy total amount exceeds safe integer range");
    let reason: "replaced" | "impossible" | undefined;
    for (const original of sources) {
      for (let index = 0; index < amount; index++) {
        const outcome = ctx.perform({ type: "copy", source: original, player, location });
        events.push(...outcome.events);
        if (outcome.status !== "done") reason ??= outcome.status === "replaced" ? "replaced" : "impossible";
        else {
          completed++;
          originals.push(original);
          if (isRef(outcome.result)) objects.push(outcome.result);
        }
      }
    }
    const linkedValues = receipt();
    return reason ? { status: "negated", reason, events } : { status: "executed", events, linkedValues };
  }
} satisfies InstructionDef<CopyArgs>;
