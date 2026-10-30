import type { RoomView } from "@riftbound/protocol";
import type { V2Projection } from "../../../../packages/protocol/src/v2/index.js";

/**
 * Leaving a running V2 match (RIFT-1161).
 *
 * Going home or closing the client used to keep the match running on the
 * server, and the next connection resumed the same match (player report
 * RIFT-1146). Leaving now means conceding: the player confirms, the client
 * concedes, then drops the room session.
 */

/** A V2 match still being played: the room is playing and nobody has won. */
export function v2MatchInProgress(room: Pick<RoomView, "status"> | null,
  projection: Pick<V2Projection, "phase" | "winnerPlayerId" | "viewerPlayerId"> | null): boolean {
  return room?.status === "playing" && projection !== null && projection.viewerPlayerId !== null &&
    projection.phase !== "ended" && projection.winnerPlayerId === null;
}

export const MATCH_EXIT_TITLE = "退出对局";
export const MATCH_EXIT_MESSAGE = "对局还在进行中，退出将视为认输，本局判对手获胜。确定退出吗？";
export const MATCH_EXIT_CONFIRM = "确认退出（认输）";
export const MATCH_EXIT_CANCEL = "继续对局";

export interface MatchExitOutcome {
  /** True when the server accepted the concession. */
  readonly conceded: boolean;
  /** Shown after leaving when the concession was not confirmed. */
  readonly notice: string | null;
}

/**
 * Concede, then leave the room whatever the answer: the player asked to go.
 * A rejected or unanswered concession is reported instead of keeping the
 * player at the table.
 */
export async function concedeAndLeave(options: {
  readonly concede: () => Promise<unknown>;
  readonly leave: () => void;
  readonly timeoutMs?: number;
}): Promise<MatchExitOutcome> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let outcome: MatchExitOutcome;
  try {
    await Promise.race([
      options.concede(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`服务端 ${Math.round(timeoutMs / 1000)} 秒内未确认`)), timeoutMs); })
    ]);
    outcome = { conceded: true, notice: null };
  } catch (error) {
    const reason = error instanceof Error && error.message.trim() !== "" ? error.message : "未知原因";
    outcome = { conceded: false, notice: `已离开对局，但认输未被服务端确认（${reason}）。` };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  options.leave();
  return outcome;
}
