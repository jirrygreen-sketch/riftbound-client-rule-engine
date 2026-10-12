export type OrchestrationErrorCode =
  | "command-rejected"
  | "room-full"
  | "invalid-token"
  | "session-replaced"
  | "stale-version"
  | "idempotency-conflict"
  | "invalid-deck"
  | "game_ended"
  | "invalid_command"
  | string;

export class FullProductOrchestrationError extends Error {
  constructor(
    message: string,
    readonly code: OrchestrationErrorCode
  ) {
    super(message);
    this.name = "FullProductOrchestrationError";
  }
}
