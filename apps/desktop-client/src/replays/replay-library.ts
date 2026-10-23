import { isDuelProjectionTransport, type DuelProjectionTransport } from "@riftbound/protocol";
import {
  isV2Projection,
  type V2Projection
} from "../../../../packages/protocol/src/v2/index.js";

/**
 * Local, machine-level replay library.
 *
 * Scope and honesty boundaries:
 * - A recording is a list of authoritative projections the server already sent
 *   to this client. Legacy records use `frames`; protocol-v2 records use the
 *   separate `v2Frames` field so historical JSON stays unchanged. Nothing here
 *   reads a private journal or an opponent's hidden zone, and every frame in a
 *   recording belongs to exactly one viewer.
 * - This is a local personal viewing index, NOT a strict engine replay and NOT
 *   a global account history. No command is ever derived or dispatched from a
 *   stored frame; playback is read-only.
 * - Every frame is re-validated with its production protocol guard on read AND
 *   on save, so a shape change fails closed instead of being trusted as JSON.
 * - Oversize or malformed input is refused, never silently truncated: a
 *   recording whose frame sequence cannot be fully read back is dropped whole,
 *   and a frame list over {@link MAX_RECORDING_FRAMES} is rejected outright.
 */

export const REPLAY_LIBRARY_STORAGE_KEY = "riftbound.desktop-client.replay-library.v1";
export const REPLAY_LIBRARY_SCHEMA_VERSION = 1;

/** Newest-first cap on stored recordings. Reaching it drops the oldest entry. */
export const MAX_REPLAY_RECORDINGS = 10;
/** A single recording may not exceed this many frames; longer input is refused. */
export const MAX_RECORDING_FRAMES = 300;
/** Protocol-v2 stores one bounded local projection per authoritative update. */
export const MAX_V2_RECORDING_FRAMES = 4096;

/** Minimal storage surface so the library works with `window.localStorage` or a test double. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ReplayRecording {
  readonly id: string;
  readonly roomId: string;
  readonly title: string;
  readonly savedAt: string;
  readonly frames: readonly DuelProjectionTransport[];
  /** V2 recordings keep their wire projections separately so old records stay byte-compatible. */
  readonly v2Frames?: readonly V2Projection[];
}

export interface ReplayLibrary {
  readonly recordings: readonly ReplayRecording[];
}

export function emptyReplayLibrary(): ReplayLibrary {
  return { recordings: [] };
}

/** The one viewer a frame sequence belongs to; `null` means a public/spectator view. */
export type ReplayFrame = DuelProjectionTransport | V2Projection;

export function replayRecordingFrameCount(recording: ReplayRecording): number {
  return recording.v2Frames?.length ?? recording.frames.length;
}

export function replayRecordingFrame(recording: ReplayRecording, index: number): ReplayFrame | undefined {
  return recording.v2Frames?.[index] ?? recording.frames[index];
}

export function isV2ReplayRecording(recording: ReplayRecording): boolean {
  return recording.v2Frames !== undefined;
}

export function frameViewerPlayerId(frame: ReplayFrame): string | null {
  return frame.viewerPlayerId;
}

/**
 * True when every frame belongs to the same viewer (including a uniform `null`
 * spectator view). A mixed-viewer sequence is never a valid recording: swapping
 * a viewer would let a local index imply someone else's hidden data.
 */
export function framesShareViewer(frames: readonly ReplayFrame[]): boolean {
  if (frames.length === 0) return false;
  const first = frames[0] as ReplayFrame;
  return frames.every(frame => frame.viewerPlayerId === first.viewerPlayerId);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[]
): boolean {
  const keys = Object.keys(value);
  if (keys.length !== required.length) return false;
  return required.every(key => Object.hasOwn(value, key));
}

/**
 * Validates a candidate recording against the real wire guard. Returns `null`
 * for anything that is not an exact, same-viewer, in-budget frame sequence.
 */
export function normalizeReplayRecording(value: unknown): ReplayRecording | null {
  if (!isRecord(value)) return null;
  if (value.v2Frames !== undefined) {
    if (!hasExactKeys(value, ["id", "roomId", "title", "savedAt", "frames", "v2Frames"])) return null;
    if (!Array.isArray(value.frames) || value.frames.length !== 0) return null;
  }
  if (!isNonEmptyString(value.id)) return null;
  if (!isNonEmptyString(value.roomId)) return null;
  if (!isNonEmptyString(value.title)) return null;
  if (typeof value.savedAt !== "string") return null;
  if (value.v2Frames !== undefined) return normalizeV2ReplayRecording(value);
  if (!hasExactKeys(value, ["id", "roomId", "title", "savedAt", "frames"])) return null;
  const rawFrames = value.frames;
  if (!Array.isArray(rawFrames)) return null;
  if (rawFrames.length === 0) return null;
  if (rawFrames.length > MAX_RECORDING_FRAMES) return null;

  const frames: DuelProjectionTransport[] = [];
  for (const candidate of rawFrames) {
    // The production guard is the only structural authority; an unknown or
    // added field fails here rather than being trusted.
    if (!isDuelProjectionTransport(candidate)) return null;
    frames.push(candidate);
  }
  if (!framesShareViewer(frames)) return null;
  if (frames.some((frame, index) => frame.match.matchId !== frames[0]!.match.matchId ||
      (index > 0 && (frame.match.stateVersion < frames[index - 1]!.match.stateVersion ||
        frame.match.eventSeq < frames[index - 1]!.match.eventSeq)))) return null;

  return {
    id: value.id,
    roomId: value.roomId,
    title: value.title,
    savedAt: value.savedAt,
    frames
  };
}

function normalizeV2ReplayRecording(value: Record<string, unknown>): ReplayRecording | null {
  const rawFrames = value.v2Frames;
  if (!Array.isArray(rawFrames) || rawFrames.length === 0 || rawFrames.length > MAX_V2_RECORDING_FRAMES) return null;
  const frames: V2Projection[] = [];
  for (const candidate of rawFrames) {
    if (!isV2Projection(candidate) || candidate.viewerPlayerId === null) return null;
    frames.push(candidate);
  }
  if (!framesShareViewer(frames)) return null;
  if (frames.some((frame, index) => frame.matchId !== frames[0]!.matchId ||
      (index > 0 && frame.stateVersion < frames[index - 1]!.stateVersion) ||
      (index > 0 && frame.eventSeq < frames[index - 1]!.eventSeq))) return null;
  return {
    id: value.id as string,
    roomId: value.roomId as string,
    title: value.title as string,
    savedAt: value.savedAt as string,
    frames: [],
    v2Frames: frames
  };
}

export function readReplayLibrary(storage: StorageLike | null): ReplayLibrary {
  if (!storage) return emptyReplayLibrary();
  let parsed: unknown;
  try {
    const raw = storage.getItem(REPLAY_LIBRARY_STORAGE_KEY);
    if (!raw) return emptyReplayLibrary();
    parsed = JSON.parse(raw);
  } catch {
    return emptyReplayLibrary();
  }
  if (!isRecord(parsed)) return emptyReplayLibrary();
  if (!hasExactKeys(parsed, ["schemaVersion", "recordings"])) return emptyReplayLibrary();
  if (parsed.schemaVersion !== REPLAY_LIBRARY_SCHEMA_VERSION) return emptyReplayLibrary();
  if (!Array.isArray(parsed.recordings)) return emptyReplayLibrary();
  if (parsed.recordings.length > MAX_REPLAY_RECORDINGS) return emptyReplayLibrary();

  const recordings: ReplayRecording[] = [];
  const seenIds = new Set<string>();
  for (const candidate of parsed.recordings) {
    const entry = normalizeReplayRecording(candidate);
    // A single unreadable sequence invalidates that recording only; it is never
    // partially restored and never silently shortened.
    if (!entry) continue;
    if (seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    recordings.push(entry);
  }
  return { recordings };
}

export function writeReplayLibrary(
  storage: StorageLike | null,
  library: ReplayLibrary
): boolean {
  if (!storage) return false;
  try {
    if (!Array.isArray(library.recordings) || library.recordings.length > MAX_REPLAY_RECORDINGS ||
        library.recordings.some(entry => normalizeReplayRecording(entry) === null) ||
        new Set(library.recordings.map(entry => entry.id)).size !== library.recordings.length) return false;
    storage.setItem(REPLAY_LIBRARY_STORAGE_KEY, serializeReplayLibrary(library));
    return true;
  } catch {
    return false;
  }
}

export function serializeReplayLibrary(library: ReplayLibrary): string {
  return JSON.stringify({
    schemaVersion: REPLAY_LIBRARY_SCHEMA_VERSION,
    recordings: library.recordings.map(entry => entry.v2Frames === undefined
      ? {
          id: entry.id,
          roomId: entry.roomId,
          title: entry.title,
          savedAt: entry.savedAt,
          frames: entry.frames
        }
      : {
          id: entry.id,
          roomId: entry.roomId,
          title: entry.title,
          savedAt: entry.savedAt,
          frames: [],
          v2Frames: entry.v2Frames
        })
  });
}

/**
 * Adds a recording to the front of the library, keeping ids unique and the
 * newest {@link MAX_REPLAY_RECORDINGS} entries. An invalid recording (bad shape,
 * mixed viewer, empty/oversize frames) leaves the library untouched — it is
 * never partially stored.
 */
export function saveReplayRecording(
  library: ReplayLibrary,
  recording: ReplayRecording
): ReplayLibrary {
  const entry = normalizeReplayRecording(recording);
  if (!entry) return library;
  const others = library.recordings.filter(candidate => candidate.id !== entry.id);
  return { recordings: [entry, ...others].slice(0, MAX_REPLAY_RECORDINGS) };
}

export function removeReplayRecording(library: ReplayLibrary, id: string): ReplayLibrary {
  return { recordings: library.recordings.filter(entry => entry.id !== id) };
}

export function findReplayRecording(
  library: ReplayLibrary,
  id: string | null
): ReplayRecording | null {
  if (id === null) return null;
  return library.recordings.find(entry => entry.id === id) ?? null;
}

export interface ReplayFrameSummary {
  readonly index: number;
  readonly schema: string;
  readonly viewerPlayerId: string | null;
  readonly matchId: string;
  readonly stage: "setup" | "playing";
  readonly phase: string | null;
  readonly turnNumber: number | null;
  readonly turnPlayerId: string | null;
  readonly priorityPlayerId: string | null;
  readonly actionCount: number;
  readonly enabledActionCount: number;
}

/**
 * Read-only description of one stored frame, read straight off the wire
 * projection. Nothing is inferred: a field the projection omits stays `null`.
 */
export function summarizeReplayFrame(
  recording: ReplayRecording,
  index: number
): ReplayFrameSummary | null {
  const frame = replayRecordingFrame(recording, index);
  if (!frame) return null;
  if ("projectionContract" in frame) {
    const actionCount = frame.actionOptions.plays.length + frame.actionOptions.moves.length +
      Number(frame.actionOptions.canEndTurn) + Number(frame.actionOptions.canAdvance === true);
    return {
      index,
      schema: frame.projectionContract,
      viewerPlayerId: frame.viewerPlayerId,
      matchId: frame.matchId,
      stage: frame.phase === "setup" ? "setup" : "playing",
      phase: frame.phase,
      turnNumber: frame.turnNumber,
      turnPlayerId: frame.activePlayerId,
      priorityPlayerId: frame.priority.playerId,
      actionCount,
      enabledActionCount: actionCount
    };
  }
  const match = frame.match;
  const playing = match.stage === "playing" ? match : null;
  return {
    index,
    schema: frame.projectionSchema,
    viewerPlayerId: frame.viewerPlayerId,
    matchId: match.matchId,
    stage: match.stage,
    phase: playing ? playing.frame.phase : null,
    turnNumber: playing ? playing.frame.turnNumber : null,
    turnPlayerId: playing ? playing.frame.turnPlayerId : null,
    priorityPlayerId: playing ? playing.frame.priorityPlayerId : null,
    actionCount: frame.actions.length,
    enabledActionCount: frame.actions.filter(action => action.enabled).length
  };
}
