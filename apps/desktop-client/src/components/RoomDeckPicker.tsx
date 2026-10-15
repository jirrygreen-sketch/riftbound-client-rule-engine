import { LayoutList, Save, Trash2, Upload } from "lucide-react";
import { DECK_ZONES, type DeckZone } from "../net/CardCatalogClient";
import type { NamedDeck } from "../decks/library";
import "./RoomDeckPicker.css";

export type RoomDeckStatus = "waiting" | "playing" | "ended";

export type DeckPickerDeckStateKind = "draft" | "pending" | "submitted" | "stale";

export interface DeckPickerDeckState {
  readonly kind: DeckPickerDeckStateKind;
  readonly label: string;
}

/**
 * What we know about the server's copy of the deck.
 *
 * `confirmedFingerprint` only ever moves forward on evidence: a submission is
 * confirmed after the server acknowledges the tracked request *and* publishes a
 * newer room revision. `pendingFingerprint` is a local "in flight" marker, it is
 * never treated as submitted.
 */
export interface SubmissionTracking {
  readonly confirmedFingerprint: string | null;
  readonly pendingFingerprint: string | null;
  readonly baselineRoomVersion: number;
  readonly baselineErrorRevision: number;
}

export const emptySubmissionTracking: SubmissionTracking = {
  confirmedFingerprint: null,
  pendingFingerprint: null,
  baselineRoomVersion: 0,
  baselineErrorRevision: 0
};

export interface SubmissionObservedInput {
  readonly roomVersion: number;
  readonly errorRevision: number;
  readonly requestPending: boolean;
}

export function beginDeckSubmission(
  state: SubmissionTracking,
  input: { readonly fingerprint: string; readonly roomVersion: number; readonly errorRevision: number }
): SubmissionTracking {
  return {
    confirmedFingerprint: state.confirmedFingerprint,
    pendingFingerprint: input.fingerprint,
    baselineRoomVersion: input.roomVersion,
    baselineErrorRevision: input.errorRevision
  };
}

/**
 * Advances the receipt tracker from authoritative room state only.
 *
 * - A newer room revision with no request in flight confirms the pending
 *   submission (the server appends a room event and re-broadcasts on success).
 * - Any error surfaced since the request started drops the pending marker and
 *   keeps the previous confirmation untouched.
 * - `requestPending === false` on its own never confirms anything, because the
 *   client clears that flag for failures and reconnects too.
 */
export function observeDeckSubmission(
  state: SubmissionTracking,
  input: SubmissionObservedInput
): SubmissionTracking {
  if (state.pendingFingerprint === null) return state;

  if (input.errorRevision !== state.baselineErrorRevision) {
    return { ...state, pendingFingerprint: null };
  }
  if (!input.requestPending && input.roomVersion > state.baselineRoomVersion) {
    return {
      confirmedFingerprint: state.pendingFingerprint,
      pendingFingerprint: null,
      baselineRoomVersion: input.roomVersion,
      baselineErrorRevision: input.errorRevision
    };
  }
  return state;
}

/**
 * Drops an in-flight submission marker without touching the last confirmed
 * deck. Called when the connection is no longer usable, so a submission is
 * never "confirmed" from a room revision we did not observe on a live socket.
 */
export function abandonPendingSubmission(state: SubmissionTracking): SubmissionTracking {
  if (state.pendingFingerprint === null) return state;
  return { ...state, pendingFingerprint: null };
}

export interface DeckPickerGateInput {
  readonly connected: boolean;
  readonly reconnecting: boolean;
  readonly roomStatus: RoomDeckStatus | null;
  readonly requestPending: boolean;
  readonly switching: boolean;
  readonly selfReady: boolean;
  readonly selfDeckSubmitted: boolean;
  readonly currentFingerprint: string;
  readonly currentDeckEmpty: boolean;
  readonly confirmedFingerprint: string | null;
  readonly pendingFingerprint: string | null;
}

export interface DeckPickerGate {
  readonly canSelectDeck: boolean;
  readonly selectBlockedReason: string | null;
  readonly needsResubmit: boolean;
  readonly canSubmitDeck: boolean;
  readonly submitBlockedReason: string | null;
  readonly canToggleReady: boolean;
  readonly readyBlockedReason: string | null;
  readonly readyLabel: string;
  readonly deckState: DeckPickerDeckState;
}

export function roomDeckPickerGate(input: DeckPickerGateInput): DeckPickerGate {
  const inWaiting = input.roomStatus === "waiting";
  const selfDeckSubmitted = inWaiting && input.selfDeckSubmitted;
  const confirmedMatches =
    input.confirmedFingerprint !== null &&
    input.confirmedFingerprint === input.currentFingerprint;

  const selectBlockedReason = selectBlockedReasonFor(input);
  const canSelectDeck = selectBlockedReason === null;

  const submitBlockedReason = submitBlockedReasonFor(input, inWaiting);
  const canSubmitDeck = submitBlockedReason === null;

  const readyBlockedReason = readyBlockedReasonFor(input, inWaiting, confirmedMatches);
  const canToggleReady = readyBlockedReason === null;

  return {
    canSelectDeck,
    selectBlockedReason,
    needsResubmit: selfDeckSubmitted && !confirmedMatches,
    canSubmitDeck,
    submitBlockedReason,
    canToggleReady,
    readyBlockedReason,
    readyLabel: input.selfReady ? "取消准备" : "准备开局",
    deckState: describeDeckState(input, inWaiting, selfDeckSubmitted, confirmedMatches)
  };
}

function selectBlockedReasonFor(input: DeckPickerGateInput): string | null {
  if (input.roomStatus === "playing") return "对局进行中，无法切换卡组。";
  if (input.roomStatus === "ended") return "对局已结束，无法切换卡组。";
  if (input.requestPending) return "正在等待服务器确认，请稍候。";
  if (input.switching) return "正在等待房间确认取消准备，请稍候。";
  if (input.roomStatus !== null && (input.reconnecting || !input.connected)) {
    return "连接中断，正在恢复，暂时无法切换卡组。";
  }
  return null;
}

function submitBlockedReasonFor(
  input: DeckPickerGateInput,
  inWaiting: boolean
): string | null {
  if (!inWaiting) {
    return input.roomStatus === null
      ? "连接服务器并进入房间后即可提交卡组。"
      : "对局已开始，无法再提交卡组。";
  }
  if (input.requestPending) return "正在等待服务器确认，请稍候。";
  if (input.currentDeckEmpty) return "当前卡组为空，请先添加卡牌。";
  return null;
}

function readyBlockedReasonFor(
  input: DeckPickerGateInput,
  inWaiting: boolean,
  confirmedMatches: boolean
): string | null {
  if (!inWaiting) {
    return input.roomStatus === null
      ? "连接服务器并进入房间等待区后即可准备。"
      : "对局已开始，无法调整准备状态。";
  }
  if (input.requestPending) return "正在等待服务器确认，请稍候。";
  if (input.switching) return "正在等待房间确认取消准备，请稍候。";
  if (input.selfReady) return null;
  if (input.pendingFingerprint === input.currentFingerprint) {
    return "正在提交当前卡组，请稍候。";
  }
  if (input.confirmedFingerprint === null) return "请先提交当前卡组。";
  if (!confirmedMatches) return "卡组已变更，请重新提交。";
  return null;
}

function describeDeckState(
  input: DeckPickerGateInput,
  inWaiting: boolean,
  selfDeckSubmitted: boolean,
  confirmedMatches: boolean
): DeckPickerDeckState {
  if (input.pendingFingerprint !== null &&
      input.pendingFingerprint === input.currentFingerprint) {
    return { kind: "pending", label: "正在提交卡组…" };
  }
  if (selfDeckSubmitted && confirmedMatches) {
    return { kind: "submitted", label: "卡组已提交" };
  }
  if (selfDeckSubmitted) {
    return { kind: "stale", label: "卡组已变更，请重新提交" };
  }
  if (!inWaiting && input.selfDeckSubmitted) {
    // Room status moved past waiting: the server copy is authoritative and the
    // local draft can no longer be compared to it.
    return { kind: "submitted", label: "卡组已提交" };
  }
  return { kind: "draft", label: "草稿 · 尚未提交" };
}

export interface RoomDeckPickerZone {
  readonly zone: DeckZone;
  readonly label: string;
  readonly count: number;
}

export interface RoomDeckPickerProps {
  readonly namedDecks: readonly NamedDeck[];
  readonly selectedDeckId: string | null;
  readonly currentDeckName: string;
  readonly currentDeckTotal: number;
  readonly currentZones: readonly RoomDeckPickerZone[];
  readonly deckState: DeckPickerDeckState;
  readonly gate: DeckPickerGate;
  readonly draftName: string;
  readonly onDraftNameChange: (name: string) => void;
  readonly onSelectDeck: (deckId: string | null) => void;
  readonly onSaveAsNamed: () => void;
  readonly onUpdateSelected: () => void;
  readonly onDeleteSelected: () => void;
  readonly onEditDeck: () => void;
  readonly notice: string | null;
}

/**
 * "Current deck" card shown before the create/join controls on the room page.
 * Purely presentational: every decision comes from props (designed to render
 * under `renderToStaticMarkup`).
 */
export function RoomDeckPicker({
  namedDecks,
  selectedDeckId,
  currentDeckName,
  currentDeckTotal,
  currentZones,
  deckState,
  gate,
  draftName,
  onDraftNameChange,
  onSelectDeck,
  onSaveAsNamed,
  onUpdateSelected,
  onDeleteSelected,
  onEditDeck,
  notice
}: RoomDeckPickerProps) {
  const zoneSummary = DECK_ZONES
    .map(zone => currentZones.find(entry => entry.zone === zone))
    .filter((entry): entry is RoomDeckPickerZone => entry !== undefined)
    .filter(entry => entry.count > 0)
    .map(entry => `${entry.label} ${entry.count}`)
    .join(" · ");

  return (
    <section className="rdp-card" aria-label="当前卡组">
      <div className="rdp-head">
        <h2 className="rdp-title">当前卡组</h2>
        <span className={`rdp-pill rdp-pill-${deckState.kind}`} data-state={deckState.kind}>
          {deckState.label}
        </span>
      </div>

      <div className="rdp-body">
        <div className="rdp-main">
          <strong className="rdp-name">{currentDeckName}</strong>
          <span className="rdp-meta">
            {currentDeckTotal > 0
              ? `${currentDeckTotal} 张 · ${zoneSummary}`
              : "暂无卡牌 · 打开卡组编辑即可开始搭建"}
          </span>
        </div>

        <div className="rdp-controls">
          <label className="rdp-field">
            <span>选择卡组</span>
            <select
              className="rdp-select"
              value={selectedDeckId ?? ""}
              disabled={!gate.canSelectDeck}
              aria-label="选择要使用的卡组"
              onChange={event => {
                const value = event.target.value;
                onSelectDeck(value === "" ? null : value);
              }}
            >
              <option value="">当前草稿（未命名）</option>
              {namedDecks.map(entry => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button" type="button" onClick={onEditDeck}>
            <LayoutList size={16} aria-hidden />
            去编辑卡组
          </button>
        </div>
      </div>

      <p className="rdp-hint">
        {gate.selectBlockedReason
          ?? "创建或加入房间都会使用这副卡组；进入等待区后仍可切换。"}
      </p>
      <p className="rdp-hint">
        本地卡组以草稿形式保存，未在服务端校验前不代表构筑合法；房间内的“已提交”以服务端结果为准。
      </p>

      <div className="rdp-save">
        <label className="rdp-field rdp-field-name">
          <span>卡组名称</span>
          <input
            className="rdp-name-input"
            value={draftName}
            maxLength={40}
            spellCheck={false}
            onChange={event => onDraftNameChange(event.target.value)}
          />
        </label>
        <button className="button primary" type="button" onClick={onSaveAsNamed}>
          <Save size={16} aria-hidden />
          保存为命名卡组
        </button>
        <button
          className="button"
          type="button"
          onClick={onUpdateSelected}
          disabled={selectedDeckId === null}
          title={selectedDeckId === null ? "请先选择一个已保存的卡组" : undefined}
        >
          <Upload size={16} aria-hidden />
          更新所选卡组
        </button>
        <button
          className="button"
          type="button"
          onClick={onDeleteSelected}
          disabled={selectedDeckId === null}
        >
          <Trash2 size={16} aria-hidden />
          删除所选
        </button>
      </div>

      {gate.needsResubmit ? (
        <p className="rdp-warn" role="status">卡组已变更，请重新提交。</p>
      ) : null}
      {notice ? <p className="rdp-notice" role="status">{notice}</p> : null}
    </section>
  );
}
