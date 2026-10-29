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
 * trait/ability/arithmetic effects. effect mode registers one permanent (or
 * explicitly bounded) copy-layer effect per source/recipient pair and never
 * creates an object. Its filter includes the recipient's zone-entry identity,
 * so a later incarnation does not inherit the old effect. textMode optionally
 * narrows a Copy Effect: rules-text reproduces source Rules Text in the same
 * field, while effect-text implements CR 479.1.d's host Rules Text → receiver
 * Effect Text mapping. That form also requires attachment: the registration
 * compares the recipient's current attachedTo identity, so detach disqualifies
 * the layer continuously and a later reattach restores it without another
 * Resolve (479.1.d, 479.4). A copying source itself in the Attached state has
 * Inactive printed Rules Text (135.4, 435.1.e, 718.2), so textMode fails closed
 * instead of treating its presence as evidence that the text is active.
 * play mode also remains blocked: Copy has no Chain destination, so Copy-to-
 * Board followed by Play would introduce an incorrect Board entry (185.2.a,
 * 440.2.c). effect.token owns ordinary token definitions; effect.play owns
 * existing playable objects. Neither is a substitute for these paths.
 * `properties` may select a non-empty subset of copyable traits. Unknown traits
 * are rejected by the schema, never silently ignored. `textMode` is the narrow
 * CR 479.1.d form and remains mutually exclusive with that subset spelling.
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
  ContinuousEffectSpec, Duration, Expr, GameEvent, InstructionDef, InstructionResult,
  LocationRef, ObjectRef, ObjectSnapshot, ResolveContext, Value
} from "../contract.js";
import {
  buildCopyEffectRegistration,
  copyEffectReceipt,
  pairCopySources,
  sameCopyRef,
  type CopyEffectPair,
} from "../copy/effect.js";

type CopyTextMode = "rules-text" | "effect-text";

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
  readonly textMode?: Expr;
  readonly properties?: Expr;
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
  const keys = ["source", "mode", "amount", "player", "location", "choiceId", "onto", "duration", "linkKey", "textMode", "properties"];
  for (const [key, expression] of Object.entries(value)) {
    if (!keys.includes(key) || !isExpr(expression)) throw new TypeError("Invalid effect.copy argument: " + key);
  }
  return { ...value } as unknown as CopyArgs;
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && isId(value.id) && Number.isSafeInteger(value.zoneEntryId) && Number(value.zoneEntryId) >= 0;
}

/** Only traits explicitly supported by the copy-layer matcher may be selected. */
function copyEffectProperties(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.length === 0)) {
    throw new TypeError("effect.copy properties must be a non-empty string list");
  }
  const allowed = new Set([
    "cardId", "name", "types", "tags", "keywords", "might", "energy", "power",
    "text", "effectText", "text->effectText",
  ]);
  const properties = [...new Set(value as string[])];
  if (properties.length === 0 || properties.some(property => !allowed.has(property))) {
    throw new TypeError("effect.copy properties contain an unsupported copyable trait");
  }
  return Object.freeze(properties);
}

/**
 * Keep the text registration local to the instruction owner. The exact
 * attachment incarnation is a function condition because the generic filter
 * matcher does not compare an object's attachedTo pointer itself.
 */
function buildCopyTextRegistration(
  actor: ObjectRef,
  pair: CopyEffectPair,
  duration: Duration,
  read: (key: string) => unknown,
  write: (key: string, value: number) => void,
  index: number,
  options: { readonly attachment: ObjectRef; readonly mode: CopyTextMode },
): { readonly effect: ContinuousEffectSpec; readonly duration: Duration } {
  const registration = buildCopyEffectRegistration(
    actor, pair, duration, read, write, index,
  );
  return {
    duration,
    effect: {
      ...registration.effect,
      filter: { ...registration.effect.filter, states: "attached" },
      effect: {
        ...registration.effect.effect,
        properties: [options.mode === "rules-text" ? "text" : "text->effectText"],
        attachment: { ...options.attachment },
        condition: (target: ObjectSnapshot) =>
          !target.types.includes("unit") &&
          target.attachedTo?.id === options.attachment.id &&
          target.attachedTo.zoneEntryId === options.attachment.zoneEntryId,
      },
    },
  };
}

function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

function refsFromLinkedValue(value: unknown): ObjectRef[] {
  if (isRef(value)) return [{ ...value }];
  if (Array.isArray(value)) return value.flatMap(refsFromLinkedValue);
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap(refsFromLinkedValue);
}

function linkedRefs(ctx: ResolveContext, key: string): unknown[] {
  const direct = ctx.linked(key);
  if (direct !== undefined) return [direct];
  // The interpreter can resolve an instruction id to that instruction's
  // named result bindings even though ctx.linked() itself only exposes keys.
  const receipt = ctx.evaluate({ kind: "linked", instructionId: key });
  return receipt === null ? [] : [receipt];
}

function currentRefs(ctx: ResolveContext, selector: Selector): ObjectRef[] {
  const values = typeof selector === "string" ? [ctx.source.ref] :
    "target" in selector ? ctx.targets(selector.target) :
      "pick" in selector ? ctx.picks(selector.pick) : linkedRefs(ctx, selector.linked);
  const refs: ObjectRef[] = [];
  for (const value of values) {
    for (const ref of refsFromLinkedValue(value)) {
      if (ctx.object(ref) !== null && !refs.some(current => sameRef(current, ref))) refs.push(ref);
    }
  }
  return refs;
}

function isLocation(value: unknown): value is LocationRef {
  return isRecord(value) && (value.type === "base" && isId(value.player) || value.type === "battlefield" && isId(value.id));
}

function copyDuration(value: unknown, source: ObjectRef): Duration | null {
  if (value === "permanent") return { type: "permanent" };
  if (value === "this-turn" || value === "end-of-turn") return { type: "end-of-turn" };
  if (value === "this-combat" || value === "end-of-combat") return { type: "end-of-combat" };
  if (value === "while-source-in-zone") return { type: "while-source-in-zone", source };
  if (isRecord(value) && value.type === "until" && isId(value.at) &&
      (value.player === undefined || isId(value.player))) {
    return { type: "until", at: value.at as never, ...(value.player === undefined ? {} : { player: value.player }) };
  }
  return null;
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
    const textMode = args.textMode === undefined ? undefined : ctx.evaluate(args.textMode);
    const properties = copyEffectProperties(
      args.properties === undefined ? undefined : ctx.evaluate(args.properties),
    );
    if (!isSelector(source)) throw new TypeError("effect.copy source must be a symbolic ObjectSelector");
    if (mode !== "create" && mode !== "play" && mode !== "effect") throw new TypeError("Invalid effect.copy mode");
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError("effect.copy amount must be a nonnegative safe integer");
    }
    if (!isId(player) || !isId(linkKey) || choiceId !== undefined && !isId(choiceId)) {
      throw new TypeError("effect.copy player, linkKey and choiceId must be nonempty strings");
    }
    if (textMode !== undefined && textMode !== "rules-text" && textMode !== "effect-text") {
      throw new TypeError("effect.copy textMode must be rules-text or effect-text");
    }
    if (textMode !== undefined && mode !== "effect") {
      throw new TypeError("effect.copy textMode requires effect mode");
    }
    if (properties !== undefined && mode !== "effect") {
      throw new TypeError("effect.copy properties requires effect mode");
    }
    if (properties !== undefined && textMode !== undefined) {
      throw new TypeError("effect.copy properties and textMode are mutually exclusive");
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

    if (mode === "effect") {
      if (args.amount !== undefined) throw new TypeError("effect.copy amount is available only for object creation");
      if (args.onto === undefined) throw new TypeError("effect.copy effect mode requires onto");
      const onto = ctx.evaluate(args.onto);
      if (!isSelector(onto)) throw new TypeError("effect.copy onto must be a symbolic ObjectSelector");
      const rawDuration = args.duration === undefined ? "permanent" : ctx.evaluate(args.duration);
      const duration = copyDuration(rawDuration, ctx.source.ref);
      if (duration === null) return negate("copy-layer-attachment-duration-unavailable");
      if (sources.length === 0) return negate("copy-layer-source-recipient-pairs-unavailable");
      let recipients = currentRefs(ctx, onto);
      if (choiceId !== undefined) {
        sources.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : left.zoneEntryId - right.zoneEntryId);
        const answer = ctx.choose<readonly ObjectRef[]>({
          id: choiceId, type: "select-objects", chooser: ctx.controller, visibility: "public",
          options: sources, min: 1, max: 1
        });
        if (!Array.isArray(answer) || answer.length !== 1 || !isRef(answer[0]) ||
            !sources.some(ref => sameRef(ref, answer[0]!))) throw new TypeError("Invalid effect.copy choice answer");
        sources = [answer[0]!];
      }
      if (recipients.length === 0) return negate();
      recipients = recipients.filter(ref => ctx.object(ref)?.zone === "board");
      if (recipients.length === 0) return negate("copy-effect-recipient-must-be-a-board-object");
      const sourceObjects = sources.flatMap(ref => {
        const snapshot = ctx.object(ref);
        return snapshot === null ? [] : [snapshot];
      });
      const recipientObjects = recipients.flatMap(ref => {
        const snapshot = ctx.object(ref);
        return snapshot === null ? [] : [snapshot];
      });
      const pairs = pairCopySources(sourceObjects, recipientObjects)
        .filter(pair => !sameCopyRef(pair.source.ref, pair.recipient.ref));
      if (pairs.length === 0) return negate("copy-layer-source-recipient-pairs-unavailable");
      if (pairs.some(pair => pair.source.attachedTo !== null) &&
          (textMode !== undefined || properties?.includes("text") || properties?.includes("text->effectText"))) {
        return negate("copy-text-source-rules-text-is-inactive");
      }
      if (textMode !== undefined) {
        if (pairs.some(pair => pair.recipient.attachedTo === null)) {
          return negate("copy-text-recipient-must-be-attached");
        }
        if (pairs.some(pair => !sameCopyRef(pair.recipient.attachedTo!, pair.source.ref))) {
          return negate("copy-text-must-copy-from-attached-host");
        }
        if (pairs.some(pair => pair.recipient.types.includes("unit"))) {
          return negate("copy-text-recipient-must-be-attached-card");
        }
      }
      const registrations = pairs.map((pair, index) => textMode === undefined
        ? (() => {
            const registration = buildCopyEffectRegistration(
              ctx.source.ref, pair, duration,
              key => ctx.linked(key), (key, value) => ctx.link(key, value), index,
            );
            return properties === undefined ? registration : {
              ...registration,
              effect: {
                ...registration.effect,
                effect: {
                  ...registration.effect.effect,
                  properties: [...properties],
                },
              },
            };
          })()
        : buildCopyTextRegistration(
            ctx.source.ref, pair, duration,
            key => ctx.linked(key), (key, value) => ctx.link(key, value),
            index, { attachment: pair.recipient.attachedTo!, mode: textMode as CopyTextMode },
          ));
      for (const registration of registrations) ctx.addContinuous(registration.effect, registration.duration);
      const value = copyEffectReceipt(pairs, duration);
      const linkedValues: Record<string, Value> = {
        [linkKey]: value as unknown as Value,
        [linkKey + ".amount"]: pairs.length,
        [linkKey + ".objects"]: pairs.map(pair => ({ ...pair.recipient.ref })),
      };
      for (const [key, linked] of Object.entries(linkedValues)) ctx.link(key, linked);
      return { status: "executed", events, linkedValues };
    }
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
