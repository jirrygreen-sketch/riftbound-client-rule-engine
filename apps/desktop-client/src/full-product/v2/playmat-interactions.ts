import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  V2Location,
  V2PlayOption,
  V2ProjectedObject,
  V2Projection
} from "../../../../../packages/protocol/src/v2/index.js";

/**
 * Playmat direct manipulation (RIFT-1144).
 *
 * Drag a hand card onto the base or a battlefield to play it, drag a unit to
 * another location to move it, left-click a rune to exhaust it for Energy and
 * right-click to recycle it for Power. Every drop is checked against the
 * server-projected action options; the commands are the same ones the side
 * panel sends, so the server stays authoritative.
 */

/** Drop zone key shared with the side panel's destination keys. */
export function v2LocationKey(location: V2Location): string {
  return location.kind === "base" ? `base:${location.playerId}` : `battlefield:${location.battlefieldId}`;
}

/**
 * Legal drop zones for playing one hand card: exactly the destinations the
 * server lists. A card that needs no destination (e.g. a spell) still drops
 * only on its listed destination; its command then omits the destination.
 */
export function v2PlayDropTargets(projection: V2Projection, cardObjectId: string): ReadonlyMap<string, V2PlayOption> {
  const targets = new Map<string, V2PlayOption>();
  // Older projections may omit actionOptions entirely: no drops are legal then.
  for (const option of projection.actionOptions?.plays ?? []) {
    if (option.cardObjectId !== cardObjectId) continue;
    const key = v2LocationKey(option.destination);
    if (!targets.has(key)) targets.set(key, option);
  }
  return targets;
}

/** Legal drop zones for moving one unit, exactly as the server lists them. */
export function v2MoveDropTargets(projection: V2Projection, objectId: string): ReadonlyMap<string, V2Location> {
  const targets = new Map<string, V2Location>();
  for (const move of projection.actionOptions?.moves ?? []) {
    if (move.objectId === objectId) targets.set(v2LocationKey(move.destination), move.destination);
  }
  return targets;
}

/**
 * Legal drop zones for moving a group of units together (RIFT-1154): only
 * destinations the server lists for every member, so one Standard Move can
 * carry the whole group.
 */
export function v2GroupMoveDropTargets(projection: V2Projection, objectIds: readonly string[]): ReadonlyMap<string, V2Location> {
  const [lead, ...rest] = objectIds;
  if (lead === undefined) return new Map();
  const targets = new Map(v2MoveDropTargets(projection, lead));
  for (const objectId of rest) {
    const allowed = v2MoveDropTargets(projection, objectId);
    for (const key of [...targets.keys()]) if (!allowed.has(key)) targets.delete(key);
  }
  return targets;
}

/** Where a unit stands, as a drop zone key; null when it is not on the board. */
function v2UnitLocationKey(object: V2ProjectedObject): string | null {
  return object.location === undefined ? null : v2LocationKey(object.location);
}

/**
 * Modifier-click selection of units that move together (RIFT-1154). Only
 * units with a listed move are taken; the group always shares one location,
 * so clicking a unit elsewhere starts a new group. Clicking units that are
 * all already selected removes them.
 */
export function v2ToggleMoveGroup(projection: V2Projection, group: readonly string[],
  clicked: readonly V2ProjectedObject[]): readonly string[] {
  const movable = new Set((projection.actionOptions?.moves ?? []).map(move => move.objectId));
  const picked = clicked.filter(object => movable.has(object.objectId));
  if (picked.length === 0) return group;
  if (picked.every(object => group.includes(object.objectId))) {
    return group.filter(objectId => !picked.some(object => object.objectId === objectId));
  }
  const where = v2UnitLocationKey(picked[0]!);
  const same = picked.filter(object => v2UnitLocationKey(object) === where).map(object => object.objectId);
  const groupWhere = group.length === 0 ? null :
    v2UnitLocationKey(projection.objects.find(object => object.objectId === group[0]) ?? picked[0]!);
  const kept = groupWhere === where ? group : [];
  return [...kept, ...same.filter(objectId => !kept.includes(objectId))];
}

/** Whether a dropped play can be sent at once or still needs target selection in the side panel. */
export function v2PlayNeedsSelection(option: V2PlayOption): boolean {
  return option.targetRequirements !== undefined && option.targetRequirements.length > 0;
}

export type V2DropResult =
  | { readonly kind: "play"; readonly option: V2PlayOption }
  | { readonly kind: "move"; readonly destination: V2Location }
  | { readonly kind: "illegal"; readonly notice: string };

/**
 * What a released drag does. Any release outside a listed drop zone, blank
 * table space included, is an illegal drop and gets a notice.
 */
export function v2ResolveDrop(projection: V2Projection, source: V2DragSource, dropKey: string | null): V2DropResult {
  if (source.kind === "move") {
    const group = source.groupObjectIds ?? [];
    const targets = group.length === 0 ? v2MoveDropTargets(projection, source.objectId)
      : v2GroupMoveDropTargets(projection, [source.objectId, ...group]);
    const destination = dropKey === null ? undefined : targets.get(dropKey);
    return destination === undefined
      ? { kind: "illegal", notice: group.length === 0 ? `${source.label} 不能移动到这里` : `${source.label} 不能一起移动到这里` }
      : { kind: "move", destination };
  }
  const option = dropKey === null ? undefined : v2PlayDropTargets(projection, source.objectId).get(dropKey);
  return option === undefined
    ? { kind: "illegal", notice: `${source.label} 不能打出到这里` }
    : { kind: "play", option };
}

/** Left click exhausts for Energy (CR 164.2.a): only a ready rune. */
export function v2RuneCanAddEnergy(rune: V2ProjectedObject): boolean {
  return rune.zoneEntryId !== undefined && rune.exhausted !== true;
}

/** Right click recycles for Power (CR 164.2.b): no exhaust cost, so an exhausted rune qualifies too. */
export function v2RuneCanAddPower(rune: V2ProjectedObject): boolean {
  return rune.zoneEntryId !== undefined;
}

export interface V2DragSource {
  readonly kind: "play" | "move";
  readonly objectId: string;
  readonly cardId?: string;
  readonly label: string;
  /** Further selected units that move together with `objectId` (RIFT-1154). */
  readonly groupObjectIds?: readonly string[];
}

export interface V2DragState {
  readonly source: V2DragSource;
  readonly startX: number;
  readonly startY: number;
  readonly x: number;
  readonly y: number;
  /** Becomes true once the pointer travels past the threshold; a shorter press stays a click. */
  readonly active: boolean;
  readonly overKey: string | null;
}

export const V2_DRAG_THRESHOLD_PX = 6;

export type V2DragEvent =
  | { readonly type: "move"; readonly x: number; readonly y: number; readonly overKey: string | null }
  | { readonly type: "cancel" };

/** Pure drag transitions; the hook only feeds pointer positions into it. */
export function v2DragReducer(state: V2DragState | null, event: V2DragEvent): V2DragState | null {
  if (state === null || event.type === "cancel") return null;
  const travelled = Math.hypot(event.x - state.startX, event.y - state.startY);
  return {
    ...state,
    x: event.x,
    y: event.y,
    active: state.active || travelled >= V2_DRAG_THRESHOLD_PX,
    overKey: event.overKey
  };
}

function dropKeyAt(x: number, y: number): string | null {
  if (typeof document === "undefined") return null;
  const element = document.elementFromPoint(x, y);
  return element?.closest("[data-drop-key]")?.getAttribute("data-drop-key") ?? null;
}

/**
 * Pointer-event drag (not the HTML5 drag API, which the Tauri window can
 * intercept for file drops). A press that never passes the threshold stays an
 * ordinary click; a completed drag swallows the click that follows it.
 */
export function useV2PointerDrag(onDrop: (source: V2DragSource, dropKey: string | null) => void) {
  const [drag, setDrag] = useState<V2DragState | null>(null);
  const dragRef = useRef<V2DragState | null>(null);
  const suppressClickRef = useRef(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const update = useCallback((next: V2DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  useEffect(() => {
    if (drag === null) return undefined;
    const onMove = (event: PointerEvent): void => {
      const next = v2DragReducer(dragRef.current, {
        type: "move", x: event.clientX, y: event.clientY, overKey: dropKeyAt(event.clientX, event.clientY)
      });
      if (next?.active) event.preventDefault();
      update(next);
    };
    const onUp = (event: PointerEvent): void => {
      const current = v2DragReducer(dragRef.current, {
        type: "move", x: event.clientX, y: event.clientY, overKey: dropKeyAt(event.clientX, event.clientY)
      });
      update(null);
      if (current?.active) {
        suppressClickRef.current = true;
        setTimeout(() => { suppressClickRef.current = false; }, 0);
        onDropRef.current(current.source, current.overKey);
      }
    };
    const onCancel = (): void => update(null);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") update(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [drag !== null, update]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = useCallback((source: V2DragSource) => (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    update({ source, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, overKey: null });
  }, [update]);

  /** Call from the source's onClick: true when the click is the tail of a drag. */
  const consumeDragClick = useCallback((): boolean => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return { drag, begin, consumeDragClick, cancel: () => update(null) };
}
