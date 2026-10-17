export type JournalReplayErrorCode =
  | "INVALID_JSON"
  | "TRUNCATED_JOURNAL"
  | "INVALID_FORMAT"
  | "INVALID_SEQUENCE"
  | "DIGEST_MISMATCH"
  | "INVALID_VIEWER"
  | "SETUP_REQUIRED"
  | "ENGINE_SETUP_FAILED"
  | "UNSUPPORTED_COMMAND"
  | "COMMAND_REJECTED"
  | "REPLAY_MISMATCH";

export class JournalReplayError extends Error {
  constructor(
    readonly code: JournalReplayErrorCode,
    readonly path: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${path}: ${message}`, options);
    this.name = "JournalReplayError";
  }
}
