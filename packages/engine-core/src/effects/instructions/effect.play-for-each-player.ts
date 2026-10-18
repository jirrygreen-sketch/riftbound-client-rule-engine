import type {
  Expr, FinalizedCostPlan, GameEvent, InstructionDef, InstructionResult,
  LocationRef, ObjectRef, ResolveContext, Schema, Value
} from "../contract.js";
import {
  evaluatePlayerScopeValue,
  isObjectRef,
  isPlayer,
  refKey,
  resolvePlayerScope,
  type PlayerScopeEntry
} from "../interpreter/player-scope.js";

/** Play one or more already-selected objects under each real player seat. */
export interface PlayForEachPlayerArgs {
  readonly objects?: Expr;
  readonly target?: string;
  readonly pick?: string;
  readonly cost?: Expr;
  readonly order?: Expr;
  readonly startingWith?: Expr;
  readonly location?: Expr;
  readonly linkKey?: Expr;
}

const ARG_KEYS = new Set(["objects", "target", "pick", "cost", "order", "startingWith", "location", "linkKey"]);

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

function parseArgs(value: unknown): PlayForEachPlayerArgs {
  if (!isRecord(value)) throw new TypeError("effect.play-for-each-player args must be an object");
  for (const key of Object.keys(value)) {
    if (!ARG_KEYS.has(key)) throw new TypeError(`Invalid effect.play-for-each-player argument: ${key}`);
    if (value[key] !== undefined && !isExpr(value[key]) && !isValue(value[key]) && !(key === "target" || key === "pick")) {
      throw new TypeError(`effect.play-for-each-player ${key} must be an Expr`);
    }
  }
  const sources = [value.objects, value.target, value.pick].filter(entry => entry !== undefined);
  if (sources.length !== 1) throw new TypeError("effect.play-for-each-player requires exactly one object source");
  if (value.target !== undefined && !id(value.target)) throw new TypeError("target must be a Pick/Target id");
  if (value.pick !== undefined && !id(value.pick)) throw new TypeError("pick must be a Pick/Target id");
  return value as unknown as PlayForEachPlayerArgs;
}

const argsSchema: Schema<PlayForEachPlayerArgs> = {
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

function location(value: Value | undefined, player: string): LocationRef | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || (value.type !== "base" && value.type !== "battlefield")) return null;
  if (value.type === "battlefield") return id(value.id) ? { type: "battlefield", id: value.id } : null;
  if (!id(value.player)) return null;
  const basePlayer = value.player === "chooser" || value.player === "controller" ? player : value.player;
  return { type: "base", player: basePlayer };
}

function cost(value: Value | undefined): FinalizedCostPlan | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || value.finalized !== true) return null;
  // A partial “ignore Energy” description cannot be turned into a payment
  // plan here: deriving printed Power would invent card semantics. Callers
  // must provide the already-finalized plan produced by Finalize.
  if (value.ignore !== undefined || value.pay !== undefined) return null;
  return value as unknown as FinalizedCostPlan;
}

type Group = { readonly playerId: string; readonly refs: readonly ObjectRef[] };
type AssignedGroups = { readonly groups: readonly Group[]; readonly stale: number };

function uniqueRefs(values: readonly ObjectRef[]): ObjectRef[] {
  const result: ObjectRef[] = [];
  for (const ref of values) if (!result.some(existing => refKey(existing) === refKey(ref))) result.push({ id: ref.id, zoneEntryId: ref.zoneEntryId });
  return result;
}

function refs(value: unknown): ObjectRef[] {
  if (Array.isArray(value)) return uniqueRefs(value.filter(isObjectRef));
  return isObjectRef(value) ? [{ id: value.id, zoneEntryId: value.zoneEntryId }] : [];
}

function groupsFromValue(value: unknown, scope: readonly PlayerScopeEntry[], context: ResolveContext): Group[] | null {
  if (Array.isArray(value)) {
    const grouped: Group[] = [];
    for (const item of value) {
      if (isRecord(item) && (isPlayer(item.player) || isPlayer(item.playerId)) && (item.objects !== undefined || item.object !== undefined)) {
        const player = (isPlayer(item.player) ? item.player : item.playerId) as string;
        grouped.push({ playerId: player, refs: refs(item.objects ?? item.object) });
      } else {
        const objectRefs = refs(item);
        for (const ref of objectRefs) {
          const snapshot = context.object(ref);
          const player = snapshot?.controller ?? snapshot?.owner;
          if (player !== undefined) grouped.push({ playerId: player, refs: [ref] });
        }
      }
    }
    return grouped;
  }
  if (!isRecord(value)) return null;
  const groups: Group[] = [];
  const objectKeys = Object.keys(value);
  // Each-player receipts are keyed by actual PlayerId and carry an objects[]
  // field. Only accept keys belonging to the trusted scope.
  for (const entry of scope) {
    const candidate = value[entry.playerId];
    if (!isRecord(candidate)) continue;
    groups.push({ playerId: entry.playerId, refs: refs(candidate.objects ?? candidate.object) });
  }
  if (groups.length > 0 || objectKeys.length === 0) return groups;
  return null;
}

function assignFlatRefs(value: unknown, scope: readonly PlayerScopeEntry[], context: ResolveContext): AssignedGroups | null {
  if (!Array.isArray(value)) {
    const grouped = groupsFromValue(value, scope, context);
    return grouped === null ? null : { groups: grouped, stale: 0 };
  }
  const result: Group[] = scope.map(entry => ({ playerId: entry.playerId, refs: [] }));
  let stale = 0;
  for (const item of value) {
    if (isRecord(item) && (isPlayer(item.player) || isPlayer(item.playerId)) &&
      (item.objects !== undefined || item.object !== undefined)) {
      const player = (isPlayer(item.player) ? item.player : item.playerId) as string;
      const group = result.find(candidate => candidate.playerId === player);
      for (const ref of refs(item.objects ?? item.object)) {
        if (context.object(ref) === null) { stale += 1; continue; }
        if (group) (group.refs as ObjectRef[]).push(ref);
      }
      continue;
    }
    for (const ref of refs(item)) {
      const snapshot = context.object(ref);
      if (snapshot === null) { stale += 1; continue; }
      const matching = result.find(group => group.playerId === snapshot.controller || group.playerId === snapshot.owner);
      // A flat list is valid only when the authoritative object snapshot names
      // the responsible seat. Never infer a player from the array position.
      if (matching) (matching.refs as ObjectRef[]).push(ref);
    }
  }
  return { groups: result, stale };
}

function scopeFor(context: ResolveContext, args: PlayForEachPlayerArgs): readonly PlayerScopeEntry[] {
  const orderValue = evaluatePlayerScopeValue(context, args.order ?? args.startingWith);
  const startingWith = orderValue === "starting-with-next-player" ? "next-player" :
    orderValue === "starting-with-current-player" ? "current-player" :
      orderValue === "next-player" || orderValue === "current-player" || isPlayer(orderValue) ? orderValue : "current-player";
  return resolvePlayerScope(context, { startingWith: startingWith as "current-player" | "next-player" | string });
}

export default {
  op: "effect.play-for-each-player",
  argsSchema,
  execute(context: ResolveContext, args: PlayForEachPlayerArgs): InstructionResult {
    const scope = scopeFor(context, args);
    if (scope.length === 0) return { status: "executed", events: [], linkedValues: { played: 0 } };
    const rawObjects = args.objects === undefined
      ? args.target !== undefined ? context.targets(args.target) : context.picks(args.pick!)
      : evaluatePlayerScopeValue(context, args.objects);
    const assignment = assignFlatRefs(rawObjects, scope, context);
    if (assignment === null) return impossible();
    const groups = assignment.groups;
    const rawCost = args.cost === undefined ? undefined : evaluatePlayerScopeValue(context, args.cost);
    const plannedCost = cost(rawCost);
    if (rawCost !== undefined && plannedCost === null) return impossible();
    const finalizedCost = plannedCost === null ? undefined : plannedCost;
    const rawLocation = args.location === undefined ? undefined : evaluatePlayerScopeValue(context, args.location);
    const events: GameEvent[] = [];
    const playedByPlayer: Record<string, Value> = {};
    const responsiblePlayerIds: Record<string, Value> = {};
    let attempted = 0;
    let played = 0;
    let stale = assignment.stale;

    const resolve = (): InstructionResult => {
      for (const seat of scope) {
        const group = groups.find(candidate => candidate.playerId === seat.playerId);
        const refsForSeat = group?.refs ?? [];
        let seatPlayed = 0;
        for (const ref of refsForSeat) {
          if (context.object(ref) === null) { stale += 1; continue; }
          attempted += 1;
          const destination = location(rawLocation, seat.playerId);
          if (destination === null) return impossible();
          const outcome = context.perform({
            type: "play",
            object: ref,
            player: seat.responsiblePlayerId,
            ...(destination === undefined ? {} : { location: destination }),
            ...(finalizedCost === undefined ? {} : { cost: finalizedCost })
          });
          events.push(...outcome.events);
          if (outcome.status !== "done") {
            return {
              status: "negated",
              reason: outcome.status === "replaced" ? "replaced" : "impossible",
              events
            };
          }
          played += 1;
          seatPlayed += 1;
        }
        playedByPlayer[seat.playerId] = seatPlayed;
        responsiblePlayerIds[seat.playerId] = seat.responsiblePlayerId;
      }
      if (attempted === 0 && stale > 0) return { status: "ignored", reason: "mistargeted" };
      const key = args.linkKey === undefined ? "played" : evaluatePlayerScopeValue(context, args.linkKey);
      if (!id(key)) return impossible();
      const result: Value = {
        count: played,
        played,
        playedByPlayer,
        responsiblePlayerIds,
        attempted,
        stale
      };
      context.link(key, result);
      return { status: "executed", events, linkedValues: { [key]: result } };
    };

    // Production transaction hosts can roll back a partial multi-player play
    // when a later action is replaced or rejected. Direct TestWorld execution
    // is already transactional through runInstruction's cloned world.
    return context.transaction === undefined ? resolve() : context.transaction(resolve);
  }
} satisfies InstructionDef<PlayForEachPlayerArgs>;
