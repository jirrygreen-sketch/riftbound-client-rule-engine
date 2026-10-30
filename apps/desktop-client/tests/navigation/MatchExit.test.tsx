import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { MatchExitDialog } from "../../src/navigation/MatchExitDialog";
import {
  MATCH_EXIT_CANCEL,
  MATCH_EXIT_CONFIRM,
  MATCH_EXIT_MESSAGE,
  concedeAndLeave,
  v2MatchInProgress
} from "../../src/navigation/match-exit";

// RIFT-1161: leaving a running match concedes it after a confirmation, so the
// next connection does not resume the abandoned match (player report RIFT-1146).
describe("RIFT-1161 leaving a running match", () => {
  const running = { phase: "main", winnerPlayerId: null, viewerPlayerId: "player-1" } as const;

  it("treats only a playing room with an undecided projection as a running match", () => {
    expect(v2MatchInProgress({ status: "playing" }, running)).toBe(true);
    expect(v2MatchInProgress({ status: "playing" }, { ...running, phase: "setup" })).toBe(true);
    expect(v2MatchInProgress({ status: "playing" }, { ...running, phase: "ended" })).toBe(false);
    expect(v2MatchInProgress({ status: "playing" }, { ...running, winnerPlayerId: "player-2" })).toBe(false);
    expect(v2MatchInProgress({ status: "waiting" }, running)).toBe(false);
    expect(v2MatchInProgress({ status: "ended" }, running)).toBe(false);
    expect(v2MatchInProgress(null, running)).toBe(false);
    expect(v2MatchInProgress({ status: "playing" }, null)).toBe(false);
    // A spectator has no seat to concede.
    expect(v2MatchInProgress({ status: "playing" }, { ...running, viewerPlayerId: null })).toBe(false);
  });

  it("concedes first and then leaves the room", async () => {
    const order: string[] = [];
    const outcome = await concedeAndLeave({
      concede: async () => { order.push("concede"); return { accepted: true }; },
      leave: () => order.push("leave")
    });
    expect(order).toEqual(["concede", "leave"]);
    expect(outcome).toEqual({ conceded: true, notice: null });
  });

  it("still leaves when the concession is rejected and says so in Chinese", async () => {
    const leave = vi.fn();
    const outcome = await concedeAndLeave({ concede: () => Promise.reject(new Error("对局已结束")), leave });
    expect(leave).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ conceded: false, notice: "已离开对局，但认输未被服务端确认（对局已结束）。" });
  });

  it("does not wait forever for an unanswered concession", async () => {
    vi.useFakeTimers();
    try {
      const leave = vi.fn();
      const pending = concedeAndLeave({ concede: () => new Promise(() => undefined), leave, timeoutMs: 10_000 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual({ conceded: false, notice: "已离开对局，但认输未被服务端确认（服务端 10 秒内未确认）。" });
      expect(leave).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks before leaving: leaving counts as conceding", () => {
    const html = renderToStaticMarkup(<MatchExitDialog busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain(MATCH_EXIT_MESSAGE);
    expect(MATCH_EXIT_MESSAGE).toContain("退出将视为认输");
    expect(html).toContain(MATCH_EXIT_CANCEL);
    expect(html).toContain(MATCH_EXIT_CONFIRM);
    const busy = renderToStaticMarkup(<MatchExitDialog busy onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(busy).toContain("正在认输…");
    expect(busy.match(/disabled=""/g)).toHaveLength(2);
  });
});
