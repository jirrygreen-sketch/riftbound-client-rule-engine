import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";
import type { DuelProjectionTransport, DuelWireFrame } from "@riftbound/protocol";
import type { V2Projection } from "../../../../packages/protocol/src/v2/index.js";
import { V2ReplayViewer } from "./V2ReplayViewer";
import {
  findReplayRecording,
  replayRecordingFrame,
  replayRecordingFrameCount,
  summarizeReplayFrame,
  type ReplayLibrary,
  type ReplayRecording
} from "./replay-library";
import "./ReplayPage.css";

export interface ReplayPageProps {
  readonly library: ReplayLibrary;
  readonly onDelete: (id: string) => void;
  readonly onSelectFrame: (recording: ReplayRecording, index: number) => void;
  readonly selectedId: string | null;
  readonly selectedFrameIndex: number;
  /**
   * Optional parent-owned slot for the read-only duel table. The parent renders
   * the authoritative `DuelBoard` for the currently selected frame here; this
   * page never renders or derives game state itself.
   */
  readonly viewer?: ReactNode;
  /**
   * Deterministic initial state of the local "展开牌桌" focus view. Production
   * leaves it unset and the user toggles the focus view; passing `true` opens
   * the very same viewer slot on the focus layer from the first render, which
   * lets SSR checks cover the real expanded layout without a DOM harness.
   */
  readonly initialTableFocus?: boolean;
}

/** Local playback cadence. Playback only moves the cursor; it never dispatches a command. */
export const REPLAY_PLAYBACK_INTERVAL_MS = 900;

/** Text of the control that opens the local, full-window table focus view. */
export const REPLAY_TABLE_FOCUS_ENTER_LABEL = "展开牌桌";

/** Text of the control that leaves the focus view and restores the timeline. */
export const REPLAY_TABLE_FOCUS_EXIT_LABEL = "返回时间轴";

/** Accessible name of the focus layer that takes over the window. */
export const REPLAY_TABLE_FOCUS_REGION_LABEL = "回放牌桌专注模式";

/** Accessible name of the compact playback toolbar shown while focused. */
export const REPLAY_TABLE_FOCUS_TOOLBAR_LABEL = "回放牌桌工具栏";

/**
 * True when the parent actually handed over a read-only table. The focus view
 * and its toggle are withheld while this is false, so no button can lead the
 * user to an empty, un-closeable layer.
 */
export function replayViewerAvailable(viewer: ReactNode | undefined): boolean {
  return viewer !== null && viewer !== undefined;
}

/**
 * Whether the local table focus layer may be shown. It requires the user's
 * request, a real parent-supplied viewer, and a selected recording whose clamped
 * cursor has a frame — the same evidence the timeline renders from. Any missing
 * piece falls back to the normal timeline so the page can never present a
 * viewerless, un-closeable focus layer.
 */
export function replayTableFocusActive(
  requested: boolean,
  viewerAvailable: boolean,
  hasFrame: boolean
): boolean {
  return requested && viewerAvailable && hasFrame;
}

/**
 * Clamps a requested frame index into `[0, frameCount - 1]`. An empty recording
 * collapses to `0` so callers never construct an out-of-range cursor.
 */
export function clampFrameIndex(frameCount: number, index: number): number {
  if (frameCount <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), frameCount - 1);
}

/** The index a "next frame" step would land on, clamped to the last frame. */
export function nextFrameIndex(frameCount: number, index: number): number {
  return clampFrameIndex(frameCount, clampFrameIndex(frameCount, index) + 1);
}

/** The index a "previous frame" step would land on, clamped to the first frame. */
export function previousFrameIndex(frameCount: number, index: number): number {
  return clampFrameIndex(frameCount, clampFrameIndex(frameCount, index) - 1);
}

/** True while a cursor still has a frame after it, i.e. playback may advance. */
export function hasNextFrame(frameCount: number, index: number): boolean {
  return clampFrameIndex(frameCount, index) < frameCount - 1;
}

/**
 * Chinese labels for the known wire phases. This mirrors the client's existing
 * phase vocabulary (`DuelMatchBoard`/`DuelWindowStatus`) exactly; it adds no new
 * rule meaning and never infers a phase from anything other than the frame.
 */
export const REPLAY_PHASE_LABELS: Readonly<Record<DuelWireFrame["phase"], string>> = {
  "awaiting-turn-start": "等待回合开始",
  awaken: "觉醒",
  beginning: "开始",
  scoring: "计分",
  channel: "引导",
  draw: "抽牌",
  main: "主阶段",
  ending: "结束",
  expiration: "失效",
  ended: "已结束"
};

/**
 * Human-readable phase for the current frame. A setup frame carries no wire
 * phase yet, so it reads as the pre-game "准备阶段"; a missing phase on a
 * playing frame stays an explicit dash. Any phase this build does not know yet
 * falls back to a readable, honest label that keeps the raw token visible.
 */
export function replayPhaseLabel(stage: "setup" | "playing", phase: string | null): string {
  if (stage === "setup") return "准备阶段";
  if (phase === null) return "—";
  return REPLAY_PHASE_LABELS[phase as DuelWireFrame["phase"]] ?? `未知阶段（${phase}）`;
}

/**
 * Seat id → displayName for the selected frame's own roster. This is the only
 * authority for a seat's name: the page never guesses an identity, and it never
 * reads an opponent's hidden zone.
 */
export function replayRosterNames(
  frame: DuelProjectionTransport | V2Projection | undefined
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  if (frame === undefined) return names;
  if ("projectionContract" in frame) {
    for (const person of frame.players) names.set(person.playerId, person.name);
    return names;
  }
  for (const person of frame.match.roster) names.set(person.playerId, person.displayName);
  return names;
}

/**
 * Resolves a projected player id to its roster name. `null` yields the explicit
 * `whenAbsent` label (e.g. 旁观 / 无); an id with no roster seat keeps the raw id
 * rather than inventing a name.
 */
export function replayPlayerLabel(
  playerId: string | null,
  names: ReadonlyMap<string, string>,
  whenAbsent: string
): string {
  if (playerId === null) return whenAbsent;
  return names.get(playerId) ?? playerId;
}

/**
 * Local replay viewer. Left column lists stored recordings, right column shows
 * the frame timeline, a read-only per-frame summary and playback controls.
 *
 * The page can expand its parent-owned viewer into a local "展开牌桌" focus
 * layer that fills the window, with only a compact playback toolbar above it
 * and no long list or summary. Expanding does not move the cursor, and the
 * selected recording and frame survive entering and leaving. The layer is only
 * ever mounted while the parent still supplies a board, so it can never be left
 * viewerless, and Escape or the "返回时间轴" control always returns to the
 * timeline.
 *
 * Honesty boundaries:
 * - Every label is read off the stored server-sent projection; the page never
 *   guesses a phase, turn, priority or action from its own logic.
 * - `onSelectFrame` is the only cursor write; the parent owns the read-only
 *   table and any board rendering. Playback only advances the cursor and never
 *   dispatches a duel command.
 * - The focus layer is a genuine modal over the window, so it traps Tab, closes
 *   on Escape and restores focus to its toggle. It adds no command surface.
 */
export function ReplayPage({
  library,
  onDelete,
  onSelectFrame,
  selectedId,
  selectedFrameIndex,
  viewer,
  initialTableFocus = false
}: ReplayPageProps) {
  const selected = findReplayRecording(library, selectedId);
  const frameCount = selected ? replayRecordingFrameCount(selected) : 0;
  const clampedIndex = clampFrameIndex(frameCount, selectedFrameIndex);

  const [playing, setPlaying] = useState(false);

  /*
   * Purely local viewing mode. It only re-arranges the existing viewer slot and
   * playback controls; it never touches the cursor, the projection, the
   * `onSelectFrame` write or any duel command. The focus layer renders the same
   * single `viewer` node, so the board is never duplicated into two boards.
   */
  const [tableFocus, setTableFocus] = useState(initialTableFocus);
  const focusToggleRef = useRef<HTMLButtonElement>(null);
  const focusCloseRef = useRef<HTMLButtonElement>(null);
  const focusLayerRef = useRef<HTMLElement>(null);
  const previousSelectedId = useRef<string | null>(null);

  const enterTableFocus = useCallback(() => {
    setTableFocus(true);
  }, []);

  const exitTableFocus = useCallback(() => {
    // Playback is a transportless cursor step, so both the cursor and a running
    // playback stay valid across the mode change; only the expanded view is
    // torn down and the selected recording / frame are preserved.
    setTableFocus(false);
  }, []);

  const summary = selected ? summarizeReplayFrame(selected, clampedIndex) : null;
  const selectedFrame = selected ? replayRecordingFrame(selected, clampedIndex) : undefined;
  const internalV2Viewer = selectedFrame !== undefined && "projectionContract" in selectedFrame
    ? <V2ReplayViewer projection={selectedFrame} />
    : null;
  const resolvedViewer = viewer ?? internalV2Viewer;
  const viewerAvailable = replayViewerAvailable(resolvedViewer);
  const rosterNames = useMemo(
    () => replayRosterNames(selectedFrame),
    [selectedFrame]
  );
  const protocolLabel = selectedFrame !== undefined && "projectionContract" in selectedFrame
    ? "协议 v2"
    : selectedFrame !== undefined ? "旧对局" : "—";
  const rowUsesInternalV2Viewer = resolvedViewer === internalV2Viewer && selectedFrame !== undefined;

  useEffect(() => {
    if (previousSelectedId.current === selectedId) return;
    previousSelectedId.current = selectedId;
    setPlaying(false);
    setTableFocus(false);
  }, [selectedId]);

  const selectIndex = useCallback(
    (index: number) => {
      if (!selected) return;
      const target = clampFrameIndex(replayRecordingFrameCount(selected), index);
      if (target === clampedIndex) return;
      onSelectFrame(selected, target);
    },
    [onSelectFrame, selected, clampedIndex]
  );

  useEffect(() => {
    if (!playing || !selected) return;
    if (!hasNextFrame(replayRecordingFrameCount(selected), clampedIndex)) {
      setPlaying(false);
      return;
    }
    const handle = setTimeout(
      () => onSelectFrame(selected, nextFrameIndex(replayRecordingFrameCount(selected), clampedIndex)),
      REPLAY_PLAYBACK_INTERVAL_MS
    );
    return () => clearTimeout(handle);
  }, [playing, selected, clampedIndex, onSelectFrame]);

  const onPickRecording = useCallback(
    (recording: ReplayRecording) => {
      setPlaying(false);
      onSelectFrame(recording, 0);
    },
    [onSelectFrame]
  );

  const recordings = useMemo(() => library.recordings, [library]);

  /*
   * The focus toggle is offered only when the parent supplied a real board and
   * the clamped cursor has a frame, i.e. exactly when expanding can succeed.
   */
  const canFocus = viewerAvailable && summary !== null;

  /*
   * The three cursor/playback controls are built once and rendered into either
   * the timeline or the compact focus toolbar. Exactly one of those branches is
   * live at a time, so there is still a single viewer slot and a single set of
   * controls in the tree.
   */
  const playbackButtons = (
    <>
      <button
        type="button"
        className="replay-control"
        aria-label="上一帧"
        disabled={clampedIndex <= 0}
        onClick={() => {
          setPlaying(false);
          selectIndex(previousFrameIndex(frameCount, clampedIndex));
        }}
      >
        上一帧
      </button>
      <button
        type="button"
        className="replay-control"
        aria-label="下一帧"
        disabled={!hasNextFrame(frameCount, clampedIndex)}
        onClick={() => {
          setPlaying(false);
          selectIndex(nextFrameIndex(frameCount, clampedIndex));
        }}
      >
        下一帧
      </button>
      <button
        type="button"
        className="replay-control"
        aria-label={playing ? "暂停播放" : "开始播放"}
        disabled={frameCount <= 1}
        onClick={() => setPlaying(value => !value)}
      >
        {playing ? "暂停" : "播放"}
      </button>
    </>
  );

  /*
   * The focus view is only ever active while a real viewer exists. If the
   * parent drops the viewer (recording deleted, or a selection without a
   * frame), the page falls straight back to the normal timeline empty state
   * instead of leaving a viewerless — and therefore un-closeable — layer
   * behind. `summary` is non-null exactly when the clamped cursor has a frame,
   * so it is the same evidence the timeline renders from.
   */
  const focusActive = replayTableFocusActive(tableFocus, viewerAvailable, summary !== null);

  /*
   * Focus handling for the in-place mode change: focus lands on the exit
   * control when the table expands, and returns to the toggle when the
   * timeline comes back — the user is never stranded without a reachable way
   * out. Escape also leaves the focus view.
   */
  const wasFocusedRef = useRef(false);
  useEffect(() => {
    if (focusActive) {
      focusCloseRef.current?.focus();
    } else if (wasFocusedRef.current) {
      focusToggleRef.current?.focus();
    }
    wasFocusedRef.current = focusActive;
  }, [focusActive]);

  useEffect(() => {
    if (!focusActive) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A card preview owns the first Escape; keep its parent table open.
      if (focusLayerRef.current?.querySelector('[role="dialog"][aria-modal="true"]')) return;
      exitTableFocus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusActive, exitTableFocus]);

  /*
   * The focus view paints over the whole window, so Tab is kept inside it: the
   * first/last control wrap around and focus can never land on a covered
   * header control the user cannot see. Escape (above) and the toolbar exit
   * control both leave, so the layer is always dismissible.
   */
  const onFocusLayerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const container = focusLayerRef.current;
    if (!container) return;
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <section
      className="replay-page"
      aria-label="对局回放"
      data-table-focus={focusActive ? "true" : "false"}
    >
      <header className="replay-page-head">
        <div className="replay-page-head-text">
          <h2 className="replay-page-title">对局回放</h2>
          <p className="replay-page-subtitle">
            保存在本机的对局画面，按当时的玩家视角回看。
          </p>
        </div>
        <div className="replay-page-head-actions">
          {canFocus ? (
            <button
              ref={focusToggleRef}
              type="button"
              className="replay-focus-toggle"
              aria-pressed={focusActive}
              aria-label={focusActive ? REPLAY_TABLE_FOCUS_EXIT_LABEL : REPLAY_TABLE_FOCUS_ENTER_LABEL}
              onClick={focusActive ? exitTableFocus : enterTableFocus}
            >
              {focusActive ? REPLAY_TABLE_FOCUS_EXIT_LABEL : REPLAY_TABLE_FOCUS_ENTER_LABEL}
            </button>
          ) : null}
          <span className="replay-page-count" aria-label="已保存回放数量">
            {recordings.length} / 10
          </span>
        </div>
      </header>

      {focusActive && summary ? (
        <section
          ref={focusLayerRef}
          className="replay-focus"
          role="dialog"
          aria-modal="true"
          aria-label={REPLAY_TABLE_FOCUS_REGION_LABEL}
          onKeyDown={onFocusLayerKeyDown}
        >
          <div
            className="replay-focus-toolbar"
            role="toolbar"
            aria-label={REPLAY_TABLE_FOCUS_TOOLBAR_LABEL}
          >
            <div className="replay-controls replay-focus-controls">{playbackButtons}</div>
            <span className="replay-focus-position" aria-live="polite">
              第 {clampedIndex + 1} / {frameCount} 帧
            </span>
            <span className="replay-focus-phase">
              {replayPhaseLabel(summary.stage, summary.phase)}
            </span>
            <button
              ref={focusCloseRef}
              type="button"
              className="replay-control replay-focus-exit"
              aria-label={REPLAY_TABLE_FOCUS_EXIT_LABEL}
              onClick={exitTableFocus}
            >
              {REPLAY_TABLE_FOCUS_EXIT_LABEL}（Esc）
            </button>
          </div>
          <div className="replay-viewer replay-focus-viewer" aria-label="回放牌桌">
            {rowUsesInternalV2Viewer ? internalV2Viewer : viewer}
          </div>
        </section>
      ) : (
        <div className="replay-page-body">
          <section className="replay-records" aria-label="回放列表">
            <h3 className="replay-section-title">已保存对局</h3>
            {recordings.length === 0 ? (
              <p className="replay-records-empty" role="status">
                还没有本机回放。完成或保存一场对局后，这里会显示可回看的画面记录。
              </p>
            ) : (
              <ul className="replay-records-list">
                {recordings.map(recording => {
                  const isSelected = recording.id === selectedId;
                  return (
                    <li
                      key={recording.id}
                      className={isSelected ? "replay-record is-selected" : "replay-record"}
                    >
                      <button
                        type="button"
                        className="replay-record-open"
                        aria-pressed={isSelected}
                        aria-label={`查看回放 ${recording.title}`}
                        onClick={() => onPickRecording(recording)}
                      >
                        <span className="replay-record-title">{recording.title}</span>
                        <span className="replay-record-meta">
                          房间 {recording.roomId} · {replayRecordingFrameCount(recording)} 帧
                        </span>
                        <span className="replay-record-protocol">
                          {recording.v2Frames === undefined ? "旧对局" : "协议 v2"}
                        </span>
                        <span className="replay-record-saved">保存于 {recording.savedAt}</span>
                      </button>
                      <button
                        type="button"
                        className="replay-record-delete"
                        aria-label={`删除回放 ${recording.title}`}
                        onClick={() => onDelete(recording.id)}
                      >
                        删除
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
  
          <section className="replay-timeline" aria-label="回放时间轴">
            <h3 className="replay-section-title">画面时间轴</h3>
            {!selected || !summary ? (
              <p className="replay-timeline-empty" role="status">
                请选择左侧的一场回放，以查看它的画面时间轴。
              </p>
            ) : (
              <>
                <div className="replay-controls">{playbackButtons}</div>

                <p className="replay-record-source" role="note">
                  回放协议：{protocolLabel} · 仅包含该玩家当时收到的投影
                </p>
  
                <label className="replay-range-label" htmlFor="replay-frame-range">
                  画面范围
                </label>
                <div className="replay-range-row">
                  <input
                    id="replay-frame-range"
                    className="replay-range"
                    type="range"
                    min={0}
                    max={Math.max(frameCount - 1, 0)}
                    step={1}
                    value={clampedIndex}
                    aria-label="画面范围"
                    onChange={event => {
                      setPlaying(false);
                      selectIndex(Number(event.target.value));
                    }}
                  />
                  <span className="replay-range-value" aria-live="polite">
                    第 {clampedIndex + 1} / {frameCount} 帧
                  </span>
                </div>
  
                <dl className="replay-summary" aria-label="当前帧摘要">
                  <div className="replay-summary-item">
                    <dt>阶段</dt>
                    <dd>{replayPhaseLabel(summary.stage, summary.phase)}</dd>
                  </div>
                  <div className="replay-summary-item">
                    <dt>回合</dt>
                    <dd>{summary.turnNumber ?? "—"}</dd>
                  </div>
                  <div className="replay-summary-item">
                    <dt>回合玩家</dt>
                    <dd>{replayPlayerLabel(summary.turnPlayerId, rosterNames, "—")}</dd>
                  </div>
                  <div className="replay-summary-item">
                    <dt>优先权</dt>
                    <dd>{replayPlayerLabel(summary.priorityPlayerId, rosterNames, "无")}</dd>
                  </div>
                  <div className="replay-summary-item">
                    <dt>可见操作</dt>
                    <dd>
                      {summary.enabledActionCount} / {summary.actionCount}
                    </dd>
                  </div>
                  <div className="replay-summary-item">
                    <dt>视角</dt>
                    <dd>{replayPlayerLabel(summary.viewerPlayerId, rosterNames, "旁观")}</dd>
                  </div>
                </dl>
  
                <p className="replay-readonly-note" role="note">
                  回放只读：播放与翻帧不会发送任何对局指令。
                </p>
  
                <div className="replay-viewer" aria-label="回放牌桌">
                  {(rowUsesInternalV2Viewer ? internalV2Viewer : viewer) ?? (
                    <p className="replay-viewer-empty" role="status">
                      未提供牌桌视图。
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
