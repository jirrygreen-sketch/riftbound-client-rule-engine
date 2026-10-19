import type {
  Condition,
  Expr,
  GameAction,
  Instruction,
  ObjectRef,
  ObjectSnapshot,
  PlayerId,
  Value
} from "../effects/contract.js";
import type { ReplacementRegistration, ReplacementResult } from "../events/pipeline-types.js";
import { evaluateCondition } from "../effects/interpreter/condition.js";
import { evaluateExpression } from "../effects/interpreter/expr.js";
import { bindResolveContext } from "../events/action-adapter.js";
import { AwaitChoice } from "../effects/contract.js";
import { BlockedReplacementError, REPLACED_EVENT_LINK, REPLACEMENT_ACTIVE_ZONES, type ReplacementAbilityInput, type ReplacementDependencies, type ReplacementPlanInput } from "./types.js";
import { actionMatchesEventPattern, filterMatchesSnapshot } from "./pattern.js";
import { planReplacementBody } from "./planner.js";

/** Evaluated replacement.event declaration before planning. */
interface EventDeclaration {
  readonly pattern: Readonly<Record<string, unknown>>;
  readonly body: readonly Instruction[];
  readonly optional: boolean;
  readonly window: "permanent" | "next-time-this-turn";
}

/** Evaluated replacement.enter declaration. */
interface EnterDeclaration {
  readonly state: "ready" | "exhausted";
  readonly filter?: Readonly<Record<string, unknown>>;
}

export interface ReplacementPlanContext {
  readonly host: ReplacementDependencies["host"];
  readonly controller: PlayerId;
  readonly evaluate: (expr: Expr) => Value;
}

const asObjectRef = (value: unknown): ObjectRef | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "id" in value && "zoneEntryId" in value
    ? (value as unknown as ObjectRef)
    : undefined;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

/** The published binding interface (RIFT-257 programs layer consumes this). */
export function bindReplacement(
  ability: ReplacementAbilityInput,
  hostRef: ObjectRef,
  deps: ReplacementDependencies
): { registration: ReplacementRegistration; cancel(): void } {
  const { host, pipeline } = deps;
  const boundSnapshot = host.object(hostRef);
  if (!boundSnapshot) throw new BlockedReplacementError("bindReplacement requires a live host snapshot");
  const id = "replacement:" + hostRef.id + ":" + hostRef.zoneEntryId;
  const controller = () => {
    const snapshot = hostSnapshot();
    if (!snapshot) throw new BlockedReplacementError("Replacement host object is gone");
    return snapshot.controller;
  };
  let cancelled = false;
  const windows = new Map<number, { boundTurn: number; used: boolean }>();

  /**
   * The host incarnation. Cards bind from their printed zone and move to the
   * Chain before entering the Board; the binding follows the object's newest
   * zone entry by id. A deleted incarnation (recreated id) stops matching.
   */
  let trackNewestIncarnation = boundSnapshot.zone !== "board";
  let hostIncarnationMissing = false;
  const hostSnapshot = (): ObjectSnapshot | null => {
    if (!trackNewestIncarnation) {
      const snapshot = host.object(hostRef);
      if (!snapshot) hostIncarnationMissing = true;
      return snapshot;
    }
    return host.objects().find(object => object.ref.id === hostRef.id) ?? null;
  };
  const hostRefNow = (): ObjectRef | null => {
    const snapshot = hostSnapshot();
    return snapshot ? snapshot.ref : null;
  };

  const ctxFor = (snapshot: ObjectSnapshot) => host.context(snapshot, controller());
  const environment = (
    snapshot: ObjectSnapshot,
    overrides?: { linked?: (key: string) => Value | undefined },
    host: ObjectRef = hostRef
  ) => ({
    context: ctxFor(snapshot),
    host,
    // Bind the affected event object as the condition's `it`. This is a
    // read-only event role; it does not add a target or a new choice.
    event: {
      it: snapshot,
      object: snapshot,
      target: snapshot
    },
    linked: (key: string): Value | undefined => (overrides?.linked ? overrides.linked(key) : ctxFor(snapshot).linked(key)),
    canLookBack: () => true,
    isIgnored: () => false
  });
  const evaluateAt = (
    snapshot: ObjectSnapshot,
    overrides?: { linked?: (key: string) => Value | undefined },
    host?: ObjectRef
  ) => (expr: Expr): Value => evaluateExpression(expr, environment(snapshot, overrides, host));
  const evaluateBodyAt = (
    snapshot: ObjectSnapshot,
    overrides?: { linked?: (key: string) => Value | undefined },
    replacedObject?: ObjectRef | null
  ) => (expr: Expr): Value => {
    if (expr.kind !== "constant" && expr.kind !== "literal") return evaluateAt(snapshot, overrides)(expr);
    const value = evaluateAt(snapshot, overrides)(expr);
    const visit = (entry: unknown): unknown => {
      if (Array.isArray(entry)) return entry.map(visit);
      if (!isRecord(entry)) return entry;
      if (typeof entry.op === "string" && isRecord(entry.args)) {
        return {
          ...entry,
          args: Object.fromEntries(Object.entries(entry.args).map(([key, argument]) => [key, visit(argument)]))
        };
      }
      if ((entry.kind === "constant" || entry.kind === "literal") && "value" in entry &&
          !(typeof entry.op === "string")) {
        return { ...entry, value: visit(entry.value) };
      }
      return Object.fromEntries(Object.entries(entry).map(([key, argument]) => [key, visit(argument)]));
    };
    return visit(value) as Value;
  };
  const testCondition = (
    condition: Condition | undefined,
    snapshot: ObjectSnapshot,
    host?: ObjectRef,
    replacedObject?: ObjectRef | null
  ): boolean => {
    if (!condition) return true;
    try {
      // The source anchor must be the exact incarnation being evaluated. For
      // an entering object this is the chain-zone/new Board incarnation, not
      // the registration-time ref. The host adapter can still resolve the
      // registration source independently when needed.
      const base = host === undefined
        ? ctxFor(snapshot)
        : bindResolveContext(ctxFor(snapshot), { source: snapshot });
      const context = replacedObject === undefined || replacedObject === null
        ? base
        : bindResolveContext(base, {
          eventObject: role => role === "it"
            ? {
              eventId: 1,
              role: "it",
              ref: replacedObject,
              snapshot: lastKnownOf(replacedObject) ?? snapshot
            }
            : null
        });
      return evaluateCondition(condition, {
        context,
        host: host ?? hostRef,
        ...(replacedObject === undefined || replacedObject === null ? {} : {
          event: { it: lastKnownOf(replacedObject) ?? snapshot }
        }),
        linked: key => context.linked(key),
        canLookBack: () => true,
        isIgnored: () => false,
        query: filter => context.query(filter)
      });
    } catch {
      return false;
    }
  };
  const evaluateConstant = <T>(snapshot: ObjectSnapshot, expr: Expr, label: string, narrow: (value: Value) => T | null): T => {
    const value = evaluateAt(snapshot)(expr);
    const narrowed = narrow(value);
    if (narrowed === null) throw new BlockedReplacementError("Unsupported " + label + " value: " + JSON.stringify(value));
    return narrowed;
  };

  /** Validate the ability once at bind time; unsupported ops fail loudly. */
  const enterDeclarations: EnterDeclaration[] = [];
  const eventDeclarations: EventDeclaration[] = [];
  for (const instruction of ability.with) {
    if (instruction.op === "replacement.enter") {
      const args = instruction.args as Readonly<Record<string, Expr>>;
      if (args.state === undefined) throw new BlockedReplacementError("replacement.enter requires a state argument");
      const state = evaluateConstant(boundSnapshot, args.state, "replacement.enter state", value =>
        value === "ready" || value === "exhausted" ? value : null
      );
      const kind = ability.replaces.event ?? ability.replaces.type ?? ability.replaces.kind;
      // A wrapper declaration carries its own event. A static entry ability
      // supplies the event through `ability.replaces`; anything else is not an
      // entry declaration and must fail closed.
      if (kind !== undefined && kind !== "object-enters-board" && kind !== "board-entry") {
        throw new BlockedReplacementError("replacement.enter requires an object-enters-board ability pattern");
      }
      const rawFilter = args.filter === undefined ? ability.replaces.filter : evaluateConstant(
        boundSnapshot,
        args.filter,
        "replacement.enter filter",
        value => isRecord(value) ? value : null
      );
      const appliesTo = args.appliesTo === undefined ? undefined : evaluateConstant(
        boundSnapshot,
        args.appliesTo,
        "replacement.enter appliesTo",
        value => isRecord(value) ? value : null
      );
      const filter = rawFilter ?? appliesTo;
      enterDeclarations.push({
        state,
        ...(isRecord(filter) ? { filter } : {}),
        ...(args.window === undefined ? {} : {
          window: evaluateConstant(boundSnapshot, args.window, "replacement.enter window", value =>
            value === "permanent" || value === "next-time-this-turn" ? value : null
          )
        })
      });
      continue;
    }
    if (instruction.op === "replacement.event") {
      const args = instruction.args as Readonly<Record<string, Expr>>;
      if (args.event === undefined) throw new BlockedReplacementError("replacement.event requires an event pattern argument");
      const pattern = evaluateConstant(boundSnapshot, args.event, "replacement.event pattern", value => (isRecord(value) ? value : null));
      let body: readonly Instruction[] = [];
      if (args.instead !== undefined) {
        body = Array.isArray(args.instead)
          ? args.instead as readonly Instruction[]
          : evaluateConstant(boundSnapshot, args.instead, "replacement.event instead", value =>
            Array.isArray(value) && value.every(item => isRecord(item) && typeof item.id === "string" && typeof item.op === "string")
              ? value as readonly Instruction[]
              : null
          );
      }
      const optionalValue = args.optional === undefined
        ? false
        : evaluateConstant(boundSnapshot, args.optional, "replacement.event optional", value => (typeof value === "boolean" ? value : null));
      const windowValue = args.window === undefined
        ? "permanent"
        : evaluateConstant(boundSnapshot, args.window, "replacement.event window", value =>
          value === "next-time-this-turn" || value === "permanent" ? value : null
        );
      eventDeclarations.push({ pattern, body, optional: optionalValue, window: windowValue });
      try {
        planReplacementBody(body, { hostRef, replacedObject: null, usedWindow: false }, {
          host,
          controller: controller(),
          evaluate: evaluateBodyAt(boundSnapshot)
        });
      } catch (error) {
        if (!(error instanceof Error) ||
            (!error.message.includes("replaced-event object binding") &&
             !error.message.includes("plan-time selector binding is unavailable"))) {
          throw error;
        }
      }
      continue;
    }
    // Non-wrapper instructions belong to the static replaces body; validate
    // them through the planner. Plan-time bindings (the replaced event's
    // object) only exist at apply time, so their errors surface then.
    try {
      planReplacementBody([instruction], { hostRef, replacedObject: null, usedWindow: false }, {
        host,
        controller: controller(),
        evaluate: evaluateBodyAt(boundSnapshot)
      });
    } catch (error) {
      // The op is supported; only its plan-time binding is unavailable here.
      // Anything else (an unsupported opcode) fails bind time loudly.
      if (!(error instanceof Error) ||
          (!error.message.includes("replaced-event object binding") &&
           !error.message.includes("plan-time selector binding is unavailable"))) {
        throw error;
      }
    }
  }
  /** The static pattern only when this is not purely an enter declaration. */
  const syntheticEnter = new WeakSet<Readonly<Record<string, unknown>>>();
  // Synthetic entry declarations are added after bind-time validation, so
  // the live declaration list (not a bind-time constant) gates matching.
  const hasEnterDeclarations = () => enterDeclarations.length > 0;
  // A static body that only orients the entering permanent ("I enter ready",
  // Accelerate's delayed ready) is the CR 369.3 entry declaration form; it
  // binds to the entry move rather than the resolver's internal chain-zone
  // entry-state action (CR 805.6).
  const staticEvent = !hasEnterDeclarations() && eventDeclarations.length === 0 ? ability.replaces : null;
  if (staticEvent) {
    const kind = staticEvent.event ?? staticEvent.type ?? staticEvent.kind;
    const body = ability.with;
    const onlySelfStateBody = body.length === 1
      && (body[0]!.op === "effect.ready" || body[0]!.op === "effect.exhaust")
      && (() => {
        const args = body[0]!.args as Readonly<Record<string, unknown>>;
        const target = (args.objects ?? args.target) as unknown;
        if (typeof target !== "object" || target === null || !("kind" in target) || (target as { kind: unknown }).kind !== "constant") {
          return false;
        }
        const value = evaluateConstant(boundSnapshot, target as unknown as Expr, "entry body target", candidate =>
          typeof candidate === "object" && candidate !== null && "kind" in candidate && ((candidate as { kind: unknown }).kind === "source" || (candidate as { kind: unknown }).kind === "self")
            ? candidate
            : null
        );
        return value !== null;
      })();
    const crossObjectStateBody = body.length === 1
      && (body[0]!.op === "effect.ready" || body[0]!.op === "effect.exhaust")
      && JSON.stringify((body[0]!.args as Readonly<Record<string, unknown>>).objects ??
        (body[0]!.args as Readonly<Record<string, unknown>>).target).includes(REPLACED_EVENT_LINK);
    const declaredState = body.length === 1 && (body[0]!.op === "effect.ready" || body[0]!.op === "effect.exhaust")
      ? body[0]!.op === "effect.ready" ? "ready" : "exhausted"
      : null;
    if (kind === "object-enters-board" && declaredState !== null && declaredState !== "exhausted" && onlySelfStateBody) {
      const state = body[0]!.op === "effect.ready" ? "ready" : "exhausted";
      const filter = staticEvent.filter as Readonly<Record<string, unknown>> | undefined;
      enterDeclarations.push({ state, ...(filter && typeof filter === "object" ? { filter } : {}) });
      const selector = (body[0]!.args as Readonly<Record<string, unknown>>).objects ??
        (body[0]!.args as Readonly<Record<string, unknown>>).target;
      if (!JSON.stringify(selector).includes(REPLACED_EVENT_LINK)) syntheticEnter.add(staticEvent);
    }
    if (kind === "object-enters-board" && declaredState === "ready" && crossObjectStateBody) {
      // The body is applied at the entry action itself through the normal
      // static replacement path, not by the host-only synthetic declaration.
      syntheticEnter.delete(staticEvent);
    }
  }
  if (staticEvent && syntheticEnter.has(staticEvent)) {
    // Only the host-scoped orientation form is fully consumed by the synthetic
    // entry declaration. Cross-object entry bodies remain matchable through
    // `staticEvent`, with `replacement.object` bound to the entering object.
  }
  // A static replacement whose body addresses `replacement.object` is still
  // an ordinary event replacement. The declared event stays live for matching;
  // the body receives the affected object at apply time. Bodies scoped to the
  // host itself remain the entry-orientation form above.

  /** One-shot window state, bound to the pipeline turn at declaration time. */
  const windowFor = (declaration: EventDeclaration) => {
    if (declaration.window !== "next-time-this-turn") return null;
    const turn = pipeline.clock.turn;
    const existing = windows.get(turn);
    if (existing) return existing;
    const state = { boundTurn: turn, used: false };
    windows.set(turn, state);
    return state;
  };
  const eventWindowOpen = (declaration: EventDeclaration): boolean => {
    const window = windowFor(declaration);
    return window === null || (window.boundTurn === pipeline.clock.turn && !window.used);
  };

  /** The object an action acts on, resolved from the live snapshot map. */
  const affectedOf = (action: GameAction): ObjectRef | undefined =>
    "target" in action ? action.target : "object" in action ? action.object : undefined;
  const playerOf = (action: GameAction): PlayerId | undefined => {
    const affected = affectedOf(action);
    if (affected) {
      return host.objects().find(object => object.ref.id === affected.id && object.ref.zoneEntryId === affected.zoneEntryId)?.controller;
    }
    return "player" in action ? action.player : undefined;
  };

  const lastKnownOf = (ref: ObjectRef): ObjectSnapshot | null => {
    const current = host.object(ref);
    if (current) return current;
    try {
      return ctxFor(boundSnapshot).lastKnown(ref);
    } catch {
      return null;
    }
  };

  const matchesPattern = (
    pattern: Readonly<Record<string, unknown>>,
    action: GameAction,
    target: { object?: ObjectRef; player?: PlayerId },
    after: boolean
  ): boolean => actionMatchesEventPattern({
    pattern,
    action,
    target,
    hostRef: hostRefNow() ?? hostRef,
    controller: controller(),
    hostSnapshot: hostSnapshot() ?? undefined,
    snapshotFor: (ref, post) => host.object(ref) ?? ((post ?? after) ? lastKnownOf(ref) : null)
  });

  const matchFor = (
    action: GameAction
  ): { declaration: EventDeclaration | null; body: readonly Instruction[]; replacedObject: ObjectRef | null } | null => {
    const affected = affectedOf(action);
    const affectedPlayer = playerOf(action) ?? controller();
    for (const declaration of eventDeclarations) {
      if (!eventWindowOpen(declaration)) continue;
      const kind = declaration.pattern.event ?? declaration.pattern.type ?? declaration.pattern.kind;
      const target = kind === "damage"
        ? { object: affected, player: affectedPlayer }
        : affected
          ? { object: affected }
          : { player: affectedPlayer };
      const matched = affected
        ? matchesPattern(declaration.pattern, action, target as { object: ObjectRef }, false)
        : matchesPattern(declaration.pattern, action, target, false);
      if (!matched) continue;
      return { declaration, body: declaration.body, replacedObject: affected ?? null };
    }
    if (staticEvent) {
      if (syntheticEnter.has(staticEvent)) return null;
      const target = affected
        ? { object: affected }
        : { player: "player" in action ? action.player : affectedPlayer };
      if (matchesPattern(staticEvent, action, target, true)) {
        return { declaration: null, body: ability.with, replacedObject: affected ?? null };
      }
    }
    return null;
  };

  /**
   * Entry-orientation replacement (CR 369.3, 805.6): matches the entry move
   * of the host. The resolver's chain-zone entry-state action lands the
   * default orientation first; a rewrite there would return "replaced" from
   * the pipeline and deadlock the resolver, so the orientation is corrected
   * on the chain-zone permanent just before the move carries it to Board.
   */
  const matchesEnterAction = (action: GameAction): boolean => {
    if (hostIncarnationMissing) return false;
    if (!hasEnterDeclarations()) return false;
    if (action.type !== "move-zone") return false;
    // The chain entry-state action is the only place a permanent's entry
    // orientation is chosen (CR 805.6); the object id locates it.
    const enteringHost = action.object.id === hostRef.id;
    const snapshot = host.object(action.object);
    if (!snapshot) return false;
    if (action.to !== "base" && action.to !== "battlefield") return false;
    const directBoardEntry = !trackNewestIncarnation && snapshot.zone === "board" && action.object.zoneEntryId === hostRef.zoneEntryId;
    if (snapshot.zone !== "chain" && !directBoardEntry) return false;
    // Entry filters describe the replaced event (CR 370.1.b): the entering
    // state the resolver already landed on the chain-zone permanent.
    if (!enterDeclarations.every(declaration => {
      if (!declaration.filter) return true;
      const crossObject = !enteringHost;
      return filterMatchesSnapshot(
        declaration.filter,
        snapshot,
        action.object,
        crossObject ? hostRefNow() ?? hostRef : action.object,
        controller(),
        hostSnapshot() ?? undefined
      );
    })) return false;
    if (!testCondition(ability.condition, snapshot, action.object, action.object)) return false;
    // A host following its newest incarnation rebinds at the chain entry;
    // it then intercepts the move itself and carries the orientation.
    // Entry declarations also cover a host already bound from the Board (for
    // example a token created directly there). They are tied to this binding's
    // exact incarnation; a later re-entry cannot reuse the registration.
    return !enteringHost
      ? snapshot.zone === "chain"
      : !trackNewestIncarnation
        ? directBoardEntry
        : action.object.zoneEntryId !== hostRef.zoneEntryId;
  };

  const optionalValues = new Set(eventDeclarations.map(declaration => declaration.optional));
  if (optionalValues.size > 1) {
    throw new BlockedReplacementError("replacement.event optional declarations must agree within one ability");
  }
  const registration: ReplacementRegistration = {
    id,
    source: boundSnapshot,
    activeZones: REPLACEMENT_ACTIVE_ZONES,
    ...(ability.optional === true || optionalValues.has(true) ? { optional: true } : {}),
    ...(ability.oncePerTurn === true ? { oncePerTurn: true } : {}),
    matches: (action: GameAction, _original: GameAction): boolean => {
      if (hostIncarnationMissing) return false;
      if (cancelled) return false;
      const snapshot = hostSnapshot();
      if (!snapshot) return false;
      if (matchesEnterAction(action)) return true;
      const match = matchFor(action);
      if (!match) return false;
      return testCondition(ability.condition, snapshot, undefined, match.replacedObject);
    },
    apply: (action: GameAction, _original: GameAction): ReplacementResult => {
      const snapshot = hostSnapshot();
      if (!snapshot) throw new BlockedReplacementError("Replacement host object is gone");
      if (matchesEnterAction(action)) {
        const declared = enterDeclarations[0]!.state;
        const entering = (action as Extract<GameAction, { type: "move-zone" }>).object;
        const stateAction: GameAction = declared === "ready" ? { type: "ready", object: entering } : { type: "exhaust", object: entering };
        // Apply the declared orientation to the chain-zone permanent, then
        // let the move carry it to the Board (CR 369.3, 805.6). A same-state
        // orientation is a no-op action the state kernel accepts.
        const directBoardEntry = !trackNewestIncarnation && entering.id === hostRef.id;
        return { status: "replace", actions: directBoardEntry ? [stateAction] : [stateAction, action] };
      }
      const match = matchFor(action);
      if (!match) throw new BlockedReplacementError("Replacement.apply called without a matching event");
      const window = match.declaration ? windowFor(match.declaration) : null;
      const hostNow = hostRefNow() ?? hostRef;
      const planInput: ReplacementPlanInput = {
        hostRef: hostNow,
        replacedObject: match.replacedObject,
        usedWindow: window !== null
      };
      const checkpoint = pipeline.checkpoint?.();
      const context = ctxFor(snapshot);
      const eventBinding = match.replacedObject === null ? null : {
        eventId: 1,
        role: "it" as const,
        ref: match.replacedObject,
        snapshot: lastKnownOf(match.replacedObject) ?? snapshot
      };
      const evaluate = match.declaration
        ? evaluateBodyAt(snapshot, { linked: key => key === REPLACED_EVENT_LINK ? match.replacedObject as unknown as Value : undefined }, match.replacedObject)
        : evaluateBodyAt(snapshot, undefined, match.replacedObject);
      const planContext = bindResolveContext(context, {
        targets: id => context.targets(id),
        picks: id => context.picks(id),
        ...(eventBinding === null ? {} : { eventObject: role => role === "it" ? eventBinding : null }),
        linked: key => key === REPLACED_EVENT_LINK
          ? match.replacedObject as unknown as Value
          : context.linked(key)
      });
      let actions: readonly GameAction[];
      try {
        actions = planReplacementBody(match.body, planInput, {
          host,
          controller: controller(),
          evaluate,
          context: planContext
        });
      } catch (error) {
        if (checkpoint !== undefined && !(error instanceof AwaitChoice)) pipeline.restore?.(checkpoint);
        throw error;
      }
      const suppressesEntry = match.declaration !== null &&
        (match.declaration.pattern.event ?? match.declaration.pattern.type ?? match.declaration.pattern.kind) === "object-enters-board" &&
        action.type === "move-zone";
      if (!suppressesEntry && match.body.length > 0 && actions.length === 0) {
        if (checkpoint !== undefined) pipeline.restore?.(checkpoint);
        throw new BlockedReplacementError(
          "replacement body planned no action; refusing to report prevention for a non-empty alternative"
        );
      }
      if (window) window.used = true;
      if (match.declaration) {
        const kind = match.declaration.pattern.event ?? match.declaration.pattern.type ?? match.declaration.pattern.kind;
        if (kind === "object-enters-board" && action.type === "move-zone" && actions.every(candidate => candidate.type !== "move-zone")) {
          // CR 370.1.b.1: "as it enters" replacements add their game action
          // to the entry event; the entering action itself still happens.
          return { status: "replace", actions: [...actions, action] };
        }
        if (actions.length === 0) return { status: "prevent" };
        return { status: "replace", actions };
      }
      return { status: "replace", actions };
    }
  };

  pipeline.registerReplacement(registration);
  return {
    registration,
    cancel() {
      cancelled = true;
      if (pipeline.unregisterReplacement) pipeline.unregisterReplacement(id);
    }
  };
}
