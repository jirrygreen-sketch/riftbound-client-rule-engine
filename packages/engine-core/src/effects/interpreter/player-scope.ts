import type { Expr, PlayerId, ResolveContext, Value } from "../contract.js";

/** The supported player walks. Values are deliberately closed. */
export type PlayerScopeMode =
  | "each-player"
  | "each-other-player"
  | "controller-and-each-opponent";

export type PlayerScopeStart = "current-player" | "next-player" | PlayerId;

export interface PlayerScopeEntry {
  readonly playerId: PlayerId;
  readonly chooser: PlayerId;
  readonly responsiblePlayerId: PlayerId;
  readonly index: number;
}

export interface PlayerScopeOptions {
  readonly mode?: PlayerScopeMode;
  readonly startingWith?: PlayerScopeStart;
  /** A runtime turn player supplied by a production adapter. */
  readonly turnPlayerId?: PlayerId;
  /** Explicit exclusions are applied after the trusted roster is resolved. */
  readonly exclude?: readonly PlayerId[];
}

type RuntimeRoster = {
  readonly playerIds?: readonly PlayerId[] | (() => readonly PlayerId[]);
  readonly trustedPlayerIds?: readonly PlayerId[] | (() => readonly PlayerId[]);
  readonly rosterPlayerIds?: readonly PlayerId[];
  readonly turnOrder?: readonly PlayerId[];
  readonly currentTurnPlayerId?: PlayerId;
  readonly turnPlayerId?: PlayerId;
  readonly currentPlayerId?: PlayerId;
  readonly players?: readonly (PlayerId | { readonly id?: unknown; readonly playerId?: unknown })[];
};

function runtime(context: ResolveContext): RuntimeRoster {
  return context as unknown as RuntimeRoster;
}

function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === "string" && value.length > 0;
}

function appendUnique(target: PlayerId[], values: readonly unknown[]): void {
  for (const value of values) {
    const id = typeof value === "object" && value !== null
      ? (value as { readonly playerId?: unknown; readonly id?: unknown }).playerId ??
        (value as { readonly id?: unknown }).id
      : value;
    if (isPlayerId(id) && !target.includes(id)) target.push(id);
  }
}

function readRoster(
  value: readonly PlayerId[] | (() => readonly PlayerId[]) | undefined,
  receiver?: unknown
): readonly PlayerId[] {
  if (value === undefined) return [];
  try {
    const result = typeof value === "function" ? value.call(receiver) : value;
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

/**
 * Resolve a roster from adapter-owned seat data before falling back to visible
 * object ownership. The adapter extensions are intentionally structural so the
 * frozen ResolveContext contract stays backward compatible. No seat is
 * fabricated from a repeat count or from a caller-supplied unknown id.
 */
export function trustedPlayerIds(context: ResolveContext): readonly PlayerId[] {
  const source = runtime(context);
  const ids: PlayerId[] = [];
  appendUnique(ids, readRoster(source.trustedPlayerIds, context));
  appendUnique(ids, readRoster(source.rosterPlayerIds, context));
  appendUnique(ids, readRoster(source.turnOrder, context));
  appendUnique(ids, readRoster(source.playerIds, context));
  appendUnique(ids, source.players ?? []);

  // TestWorld and older adapters expose no roster in ResolveContext. Their
  // player identities remain authoritative when exposed by the context object.
  if (ids.length === 0) {
    for (const snapshot of context.query({})) {
      appendUnique(ids, [snapshot.owner, snapshot.controller]);
    }
  } else {
    // Visible snapshots may contain a newly-created trusted seat. Preserve the
    // adapter's order and append only identities it actually exposes.
    for (const snapshot of context.query({})) {
      if (ids.includes(snapshot.owner) || ids.includes(snapshot.controller)) continue;
      // Do not widen an explicit roster with arbitrary object metadata.
      if (source.playerIds === undefined && source.trustedPlayerIds === undefined &&
        source.rosterPlayerIds === undefined && source.players === undefined) {
        appendUnique(ids, [snapshot.owner, snapshot.controller]);
      }
    }
  }
  appendUnique(ids, [context.controller]);
  return ids;
}

function currentTurnPlayer(context: ResolveContext, explicit?: PlayerId): PlayerId {
  if (isPlayerId(explicit)) return explicit;
  const source = runtime(context);
  return source.currentTurnPlayerId ?? source.turnPlayerId ?? source.currentPlayerId ?? context.controller;
}

function orderedRoster(context: ResolveContext): PlayerId[] {
  const source = runtime(context);
  const declared = readRoster(source.turnOrder, context);
  if (declared.length > 0) {
    const ids = trustedPlayerIds(context);
    const ordered = declared.filter(id => ids.includes(id));
    for (const id of ids) if (!ordered.includes(id)) ordered.push(id);
    return ordered;
  }
  return [...trustedPlayerIds(context)];
}

function rotate(ids: readonly PlayerId[], start: PlayerId): PlayerId[] | null {
  const index = ids.indexOf(start);
  if (index < 0) return null;
  return [...ids.slice(index), ...ids.slice(0, index)];
}

/**
 * Build the ordered chooser/responsibility scope. Each entry represents one
 * real seat; chooser and responsiblePlayerId are explicit to prevent callers
 * from deriving responsibility from a repeat index.
 */
export function resolvePlayerScope(
  context: ResolveContext,
  options: PlayerScopeOptions = {}
): readonly PlayerScopeEntry[] {
  const mode = options.mode ?? "each-player";
  const roster = orderedRoster(context);
  if (roster.length === 0) return [];
  const turnPlayer = currentTurnPlayer(context, options.turnPlayerId);
  const start = options.startingWith ?? "current-player";
  const startPlayer = start === "next-player"
    ? rotate(roster, turnPlayer)?.[1] ?? roster[0]!
    : start === "current-player" ? turnPlayer : start;
  const rotated = rotate(roster, startPlayer);
  if (rotated === null) return [];

  const excluded = new Set(options.exclude ?? []);
  let selected = rotated.filter(id => !excluded.has(id));
  if (mode === "each-other-player") selected = selected.filter(id => id !== context.controller);
  else if (mode === "controller-and-each-opponent") {
    // This mode is still a real seat walk; force the controller to the front
    // while preserving the roster order of all opponents.
    selected = [context.controller, ...selected.filter(id => id !== context.controller)];
  }
  return selected.map((playerId, index) => ({
    playerId,
    chooser: playerId,
    responsiblePlayerId: playerId,
    index
  }));
}

/** Evaluate a literal/Expr argument without accepting an invented fallback. */
export function evaluatePlayerScopeValue(context: ResolveContext, value: Expr | Value | undefined): Value | undefined {
  return value === undefined ? undefined : typeof value === "object" && value !== null &&
    !Array.isArray(value) && typeof (value as { readonly kind?: unknown }).kind === "string"
    ? context.evaluate(value as Expr)
    : value as Value;
}

export function isPlayer(value: unknown): value is PlayerId {
  return isPlayerId(value);
}

export function isObjectRef(value: unknown): value is { readonly id: string; readonly zoneEntryId: number } {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as { readonly id?: unknown }).id === "string" &&
    Number.isSafeInteger((value as { readonly zoneEntryId?: unknown }).zoneEntryId);
}

export function refKey(value: { readonly id: string; readonly zoneEntryId: number }): string {
  return JSON.stringify([value.id, value.zoneEntryId]);
}
