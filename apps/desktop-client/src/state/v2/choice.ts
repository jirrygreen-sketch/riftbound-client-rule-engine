import type {
  V2ChoiceAnswer,
  V2ChooseCommand,
  V2ObjectRef,
  V2PendingChoice
} from "../../../../../packages/protocol/src/v2/index.js";

export interface V2ChoiceUiState {
  readonly status: "none" | "pending" | "expired";
  readonly choice: V2PendingChoice;
  readonly startedAt: number | null;
  readonly expiresAt: number | null;
  readonly answerable: boolean;
}

export interface V2ChoiceUiOptions {
  readonly viewerPlayerId?: string | null;
  /** A local UI deadline. The server remains authoritative for acceptance. */
  readonly timeoutMs?: number;
  readonly now?: number;
}

export const DEFAULT_CHOICE_TIMEOUT_MS = 30_000;

export function createV2ChoiceUiState(
  pending: V2PendingChoice,
  options: V2ChoiceUiOptions = {}
): V2ChoiceUiState {
  return updateV2ChoiceUiState(null, pending, options);
}

export function updateV2ChoiceUiState(
  previous: V2ChoiceUiState | null,
  pending: V2PendingChoice,
  options: V2ChoiceUiOptions = {}
): V2ChoiceUiState {
  const now = options.now ?? Date.now();
  if (pending.status === "none") {
    return { status: "none", choice: pending, startedAt: null, expiresAt: null, answerable: false };
  }

  // `undefined` is the production default. Only an explicit zero is treated as
  // an immediate local expiry; otherwise a server choice would be instantly
  // unanswerable in the desktop controller.
  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_CHOICE_TIMEOUT_MS : Math.max(0, options.timeoutMs);
  const sameChoice = previous?.choice.status === "pending" && previous.choice.choiceId === pending.choiceId &&
    previous.choice.stateVersion === pending.stateVersion;
  const startedAt = sameChoice ? previous.startedAt ?? now : now;
  const expiresAt = timeoutMs === 0 ? startedAt : startedAt + timeoutMs;
  const expired = now >= expiresAt;
  const answerable = pending.ownerPlayerId === options.viewerPlayerId && !expired;
  return {
    status: expired ? "expired" : "pending",
    choice: pending,
    startedAt,
    expiresAt,
    answerable
  };
}

export function refreshV2ChoiceUiState(
  state: V2ChoiceUiState,
  options: Pick<V2ChoiceUiOptions, "viewerPlayerId" | "now"> = {}
): V2ChoiceUiState {
  if (state.choice.status === "none" || state.expiresAt === null) return state;
  const now = options.now ?? Date.now();
  const expired = now >= state.expiresAt;
  return {
    ...state,
    status: expired ? "expired" : "pending",
    answerable: state.choice.ownerPlayerId === options.viewerPlayerId && !expired
  };
}

export function isLegalV2ChoiceAnswer(
  state: V2ChoiceUiState,
  answer: V2ChoiceAnswer,
  viewerPlayerId?: string | null
): boolean {
  if (state.choice.status === "none" || state.status === "expired" || !state.answerable) return false;
  if (viewerPlayerId !== undefined && state.choice.ownerPlayerId !== viewerPlayerId) return false;
  return answerMatchesChoice(state.choice, answer);
}

export function buildV2ChooseCommand(
  state: V2ChoiceUiState,
  answer: V2ChoiceAnswer,
  commandId: string
): V2ChooseCommand | null {
  if (!isLegalV2ChoiceAnswer(state, answer)) return null;
  if (state.choice.status !== "pending") return null;
  return {
    type: "choose",
    commandId,
    stateVersion: state.choice.stateVersion,
    choiceId: state.choice.choiceId,
    answer
  };
}

function answerMatchesChoice(choice: Extract<V2PendingChoice, { status: "pending" }>, answer: V2ChoiceAnswer): boolean {
  if (Array.isArray(answer)) {
    if (choice.min !== undefined && answer.length < choice.min) return false;
    if (choice.max !== undefined && answer.length > choice.max) return false;
    return answer.every(item => answerMatchesOptions(choice.options, item));
  }
  if (choice.kind === "number" && typeof answer === "number") {
    return (choice.min === undefined || answer >= choice.min) && (choice.max === undefined || answer <= choice.max);
  }
  return answerMatchesOptions(choice.options, answer as ChoiceAtom);
}

type ChoiceAtom = string | number | boolean | V2ObjectRef;

function answerMatchesOptions(
  options: readonly { readonly id: string; readonly value?: string | number | boolean }[] | undefined,
  answer: ChoiceAtom
): boolean {
  if (options === undefined) return true;
  return options.some(option => option.id === answer || option.value === answer ||
    (typeof answer === "object" && typeof answer.objectId === "string" && option.value === answer.objectId));
}

