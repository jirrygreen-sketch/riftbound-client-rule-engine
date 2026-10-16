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
  const environment = (snapshot: ObjectSnapshot, overrides?: { linked?: (key: string) => Value | undefined }) => ({
    context: ctxFor(snapshot),
    host: hostRef,
    linked: (key: string): Value | undefined => (overrides?.linked ? overrides.linked(key) : ctxFor(snapshot).linked(key)),
    canLookBack: () => true,
    isIgnored: () => false
  });
  const evaluateAt = (snapshot: ObjectSnapshot, overrides?: { linked?: (key: string) => Value | undefined }) =>
    (expr: Expr): Value => evaluateExpression(expr, environment(snapshot, overrides));
  const testCondition = (condition: Condition | undefined, snapshot: ObjectSnapshot): boolean => {
    if (!condition) return true;
    try {
      return evaluateCondition(condition, environment(snapshot));
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
      enterDeclarations.push({ state });
      continue;
    }
    if (instruction.op === "replacement.event") {
      const args = instruction.args as Readonly<Record<string, Expr>>;
      if (args.event === undefined) throw new BlockedReplacementError("replacement.event requires an event pattern argument");
      const pattern = evaluateConstant(boundSnapshot, args.event, "replacement.event pattern", value => (isRecord(value) ? value : null));
      let body: readonly Instruction[] = [];
      if (args.instead !== undefined) {
        if (!Array.isArray(args.instead)) {
          throw new BlockedReplacementError("replacement.event instead must be an instruction body");
        }
        body = args.instead as readonly Instruction[];
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
      continue;
    }
    // Non-wrapper instructions belong to the static replaces body; validate
    // them through the planner. Plan-time bindings (the replaced event's
    // object) only exist at apply time, so their errors surface then.
    try {
      planReplacementBody([instruction], { hostRef, replacedObject: null, usedWindow: false }, {
        host,
        controller: controller(),
        evaluate: evaluateAt(boundSnapshot)
      });
    } catch (error) {
      // The op is supported; only its plan-time binding is unavailable here.
      // Anything else (an unsupported opcode) fails bind time loudly.
      if (!(error instanceof Error) || !error.message.includes("replaced-event object binding")) {
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
    const declaredState = body.length === 1 && (body[0]!.op === "effect.ready" || body[0]!.op === "effect.exhaust")
      ? body[0]!.op === "effect.ready" ? "ready" : "exhausted"
      : null;
    if (kind === "object-enters-board" && declaredState !== null && declaredState !== "exhausted" && onlySelfStateBody) {
      const state = body[0]!.op === "effect.ready" ? "ready" : "exhausted";
      const filter = staticEvent.filter as Readonly<Record<string, unknown>> | undefined;
      enterDeclarations.push({ state, ...(filter && typeof filter === "object" ? { filter } : {}) });
      syntheticEnter.add(staticEvent);
    }
  }

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
    if (action.object.id !== hostRef.id) return false;
    const snapshot = host.object(action.object);
    if (!snapshot) return false;
    if ((action.to !== "base" && action.to !== "battlefield") || snapshot.zone !== "chain") return false;
    // Entry filters describe the replaced event (CR 370.1.b): the entering
    // state the resolver already landed on the chain-zone permanent.
    if (!enterDeclarations.every(declaration => {
      if (!declaration.filter) return true;
      return filterMatchesSnapshot(declaration.filter, snapshot, action.object, hostRefNow() ?? action.object, controller());
    })) return false;
    // A host following its newest incarnation rebinds at the chain entry;
    // it then intercepts the move itself and carries the orientation.
    return trackNewestIncarnation && action.object.zoneEntryId !== hostRef.zoneEntryId;
  };

  const registration: ReplacementRegistration = {
    id,
    source: boundSnapshot,
    activeZones: REPLACEMENT_ACTIVE_ZONES,
    matches: (action: GameAction, _original: GameAction): boolean => {
      if (hostIncarnationMissing) return false;
      if (cancelled) return false;
      const snapshot = hostSnapshot();
      if (!snapshot) return false;
      if (matchesEnterAction(action)) return true;
      const match = matchFor(action);
      if (!match) return false;
      return testCondition(ability.condition, snapshot);
    },
    apply: (action: GameAction, _original: GameAction): ReplacementResult => {
      const snapshot = hostSnapshot();
      if (!snapshot) throw new BlockedReplacementError("Replacement host object is gone");
      if (matchesEnterAction(action)) {
        const declared = enterDeclarations[0]!.state;
        const hostNow = hostRefNow() ?? (action as Extract<GameAction, { type: "move-zone" }>).object;
        const stateAction: GameAction = declared === "ready" ? { type: "ready", object: hostNow } : { type: "exhaust", object: hostNow };
        // Apply the declared orientation to the chain-zone permanent, then
        // let the move carry it to the Board (CR 369.3, 805.6). A same-state
        // orientation is a no-op action the state kernel accepts.
        return { status: "replace", actions: [stateAction, action] };
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
      const evaluate = match.declaration
        ? evaluateAt(snapshot, { linked: key => key === REPLACED_EVENT_LINK ? match.replacedObject as unknown as Value : undefined })
        : evaluateAt(snapshot);
      const actions = planReplacementBody(match.body, planInput, { host, controller: controller(), evaluate });
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
