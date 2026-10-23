import {
  isV2EngineEvent,
  isV2Projection,
  type V2EngineEvent,
  type V2Projection
} from "../../../../packages/protocol/src/v2/index.js";
import {
  MAX_V2_RECORDING_FRAMES,
  type ReplayRecording
} from "./replay-library";

export interface V2ReplayCaptureSource {
  readonly roomId: string | null;
  readonly sessionPlayerId: string | null;
  readonly projection: V2Projection | null;
  readonly events: readonly V2EngineEvent[];
}

/** Bounded local capture state. Frames contain only the authenticated viewer projection. */
export interface V2ReplayCapture {
  readonly key: string;
  readonly roomId: string;
  readonly matchId: string;
  readonly viewerPlayerId: string;
  readonly frames: readonly V2Projection[];
  readonly lastEventSeq: number;
}

export interface V2ReplayCaptureResult {
  readonly capture: V2ReplayCapture | null;
  readonly rejectedReason: string | null;
}

function eventVisibleToViewer(event: V2EngineEvent, viewerPlayerId: string): boolean {
  if (event.audience.visibility === "hidden") return false;
  if (event.audience.visibility === "owner-only" &&
      event.audience.ownerPlayerId !== viewerPlayerId) return false;
  return Object.values(event.payload).every(field =>
    field.visibility !== "owner-only" || field.ownerPlayerId === viewerPlayerId
  );
}

function newV2Events(
  projection: V2Projection,
  streamEvents: readonly V2EngineEvent[],
  lastEventSeq: number
): readonly V2EngineEvent[] {
  const bySeq = new Map<number, V2EngineEvent>();
  for (const event of [...streamEvents, ...projection.events]) {
    if (!isV2EngineEvent(event)) continue;
    if (event.eventSeq > projection.eventSeq) continue;
    if (!eventVisibleToViewer(event, projection.viewerPlayerId ?? "")) continue;
    if (event.eventSeq <= lastEventSeq) continue;
    bySeq.set(event.eventSeq, structuredClone(event));
  }
  return [...bySeq.values()].sort((left, right) => left.eventSeq - right.eventSeq);
}

/**
 * Adds one `useV2Match` snapshot to a viewer-scoped capture.
 *
 * The projection guard is applied before identity checks and again after
 * compacting events, so a malformed or mixed-viewer projection can never enter
 * the local replay. Repeated cumulative event data is stored once, on the first
 * frame at which this client observed it. No frame is silently discarded when
 * the recording budget is reached; the caller receives an explicit reason.
 */
export function captureV2ReplaySnapshot(
  current: V2ReplayCapture | null,
  source: V2ReplayCaptureSource
): V2ReplayCaptureResult {
  const projection = source.projection;
  if (projection === null) return { capture: current, rejectedReason: null };
  if (!isV2Projection(projection)) {
    return { capture: current, rejectedReason: "V2 投影未通过本地回放校验，未捕获。" };
  }
  if (source.sessionPlayerId === null || projection.viewerPlayerId !== source.sessionPlayerId) {
    return { capture: current, rejectedReason: "V2 投影不属于当前玩家视角，未捕获。" };
  }
  if (source.roomId === null) {
    return { capture: current, rejectedReason: "V2 房间身份尚未就绪，未捕获。" };
  }

  const key = `v2:${source.roomId}:${projection.matchId}:${source.sessionPlayerId}`;
  const base: V2ReplayCapture = current?.key === key
    ? current
    : {
        key,
        roomId: source.roomId,
        matchId: projection.matchId,
        viewerPlayerId: source.sessionPlayerId,
        frames: [],
        lastEventSeq: 0
      };
  const previous = base.frames.at(-1);
  if (previous !== undefined &&
      (projection.stateVersion < previous.stateVersion || projection.eventSeq < base.lastEventSeq)) {
    return { capture: base, rejectedReason: "V2 回放时钟倒退，已忽略该画面。" };
  }
  if (previous !== undefined &&
      previous.stateVersion === projection.stateVersion &&
      previous.eventSeq === projection.eventSeq) {
    return { capture: base, rejectedReason: null };
  }
  if (base.frames.length >= MAX_V2_RECORDING_FRAMES) {
    return { capture: base, rejectedReason: `V2 回放已达到 ${MAX_V2_RECORDING_FRAMES} 帧上限，本局未自动保存。` };
  }

  const events = newV2Events(projection, source.events, base.lastEventSeq);
  const frame = structuredClone({ ...projection, events });
  if (!isV2Projection(frame)) {
    return { capture: base, rejectedReason: "V2 回放事件未通过隐私校验，未捕获该画面。" };
  }
  const lastEventSeq = events.at(-1)?.eventSeq ?? base.lastEventSeq;
  return {
    capture: {
      ...base,
      frames: [...base.frames, frame],
      lastEventSeq: Math.max(base.lastEventSeq, lastEventSeq)
    },
    rejectedReason: null
  };
}

/** The capture is complete only after the authority has projected a terminal state. */
export function v2ReplayCaptureComplete(capture: V2ReplayCapture | null): boolean {
  const final = capture?.frames.at(-1);
  return final !== undefined && (final.phase === "ended" || final.winnerPlayerId !== null);
}

export function v2ReplayRecording(
  capture: V2ReplayCapture,
  savedAt: string
): ReplayRecording {
  const first = capture.frames[0];
  const title = first === undefined
    ? capture.matchId
    : first.players.map(player => player.name || player.playerId).join(" vs ");
  return {
    id: capture.key,
    roomId: capture.roomId,
    title,
    savedAt,
    frames: [],
    v2Frames: structuredClone(capture.frames)
  };
}
