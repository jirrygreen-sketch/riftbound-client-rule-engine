import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  isDuelProjectionTransport,
  type DuelProjectionTransport
} from "@riftbound/protocol";
import {
  ReplayPage,
  clampFrameIndex,
  hasNextFrame,
  nextFrameIndex,
  previousFrameIndex,
  replayPhaseLabel,
  replayPlayerLabel,
  replayRosterNames,
  replayTableFocusActive,
  replayViewerAvailable,
  REPLAY_TABLE_FOCUS_ENTER_LABEL,
  REPLAY_TABLE_FOCUS_EXIT_LABEL,
  REPLAY_TABLE_FOCUS_REGION_LABEL,
  REPLAY_TABLE_FOCUS_TOOLBAR_LABEL,
  REPLAY_PLAYBACK_INTERVAL_MS,
  type ReplayPageProps
} from "../../src/replays/ReplayPage";
import {
  emptyReplayLibrary,
  saveReplayRecording,
  type ReplayLibrary,
  type ReplayRecording
} from "../../src/replays/replay-library";

/*
 * SSR-only here: `renderToStaticMarkup` covers the rendered contract (labels,
 * ARIA, disabled gating, slot behavior). It is NOT a real-DOM click test; the
 * timeline transitions are covered by the pure cursor helpers below and by the
 * ReplayLibrary storage tests. Frames are tracked protocol fixtures asserted
 * against the production transport guard.
 */
const v1Fixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../../packages/protocol/test/fixtures/duel-projections.json", import.meta.url
)), "utf8")) as Record<string, Record<string, DuelProjectionTransport>>;

function frame(scenario: string, viewer: "p1" | "p2" | null = "p1"): DuelProjectionTransport {
  const source = v1Fixtures[scenario]?.[viewer === null ? "null" : viewer];
  if (!source) throw Error(`missing fixture ${scenario}/${viewer}`);
  const clone = structuredClone(source);
  expect(isDuelProjectionTransport(clone)).toBe(true);
  return clone;
}

/**
 * A tracked fixture with real roster display names, re-validated with the
 * production transport guard so the test cannot drift from the wire shape.
 */
function namedFrame(
  scenario: string,
  viewer: "p1" | "p2" | null,
  names: Readonly<Record<string, string>>
): DuelProjectionTransport {
  const clone = frame(scenario, viewer);
  (clone as unknown as { match: { roster: { playerId: string; displayName: string }[] } })
    .match.roster = clone.match.roster.map(person => ({
      playerId: person.playerId,
      displayName: names[person.playerId] ?? person.displayName
    }));
  expect(isDuelProjectionTransport(clone)).toBe(true);
  return clone;
}

function recording(overrides: Partial<ReplayRecording> = {}): ReplayRecording {
  return {
    id: "rec-1",
    roomId: "room-1",
    title: "测试对局",
    savedAt: "2026-10-13T00:00:00.000Z",
    frames: [frame("playing", "p1"), frame("changed", "p1")],
    ...overrides
  };
}

function render(overrides: Partial<ReplayPageProps> = {}): string {
  const props: ReplayPageProps = {
    library: emptyReplayLibrary(),
    onDelete: () => {},
    onSelectFrame: () => {},
    selectedId: null,
    selectedFrameIndex: 0,
    ...overrides
  };
  return renderToStaticMarkup(<ReplayPage {...props} />);
}

function tagFor(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `control ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<", index);
  const close = html.indexOf(">", index);
  return html.slice(open, close + 1);
}

function countOccurrences(html: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = html.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
}

const replayPageCss = readFileSync(
  fileURLToPath(new URL("../../src/replays/ReplayPage.css", import.meta.url)),
  "utf8"
);

/** Declaration body of the last top-level `<selector> { ... }` block. */
function cssBlock(css: string, selector: string): string {
  const start = css.lastIndexOf(`\n${selector} {`);
  expect(start, `CSS block ${selector} not found`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

/** Top-level selectors, i.e. rules that are not nested inside another block. */
function topLevelSelectors(css: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  for (const line of css.split("\n")) {
    const trimmed = line.trim();
    if (depth === 0 && trimmed.endsWith("{") && !trimmed.startsWith("@") && !trimmed.startsWith("/*")) {
      selectors.push(trimmed.slice(0, -1).trim());
    }
    depth += countOccurrences(line, "{") - countOccurrences(line, "}");
  }
  return selectors;
}

describe("ReplayPage cursor helpers", () => {
  it("clamps an index into the recording bounds", () => {
    expect(clampFrameIndex(0, 5)).toBe(0);
    expect(clampFrameIndex(3, -4)).toBe(0);
    expect(clampFrameIndex(3, 9)).toBe(2);
    expect(clampFrameIndex(3, 1.9)).toBe(1);
    expect(clampFrameIndex(3, Number.NaN)).toBe(0);
  });

  it("steps next/previous without running off either end", () => {
    expect(nextFrameIndex(3, 0)).toBe(1);
    expect(nextFrameIndex(3, 2)).toBe(2);
    expect(previousFrameIndex(3, 0)).toBe(0);
    expect(previousFrameIndex(3, 2)).toBe(1);
    expect(hasNextFrame(3, 2)).toBe(false);
    expect(hasNextFrame(3, 1)).toBe(true);
    expect(hasNextFrame(0, 0)).toBe(false);
  });
});

describe("ReplayPage SSR contract", () => {
  it("renders the required regions with accessible labels", () => {
    const html = render();
    expect(html).toContain('aria-label="对局回放"');
    expect(html).toContain('aria-label="回放列表"');
    expect(html).toContain('aria-label="回放时间轴"');
    expect(html).toContain('aria-label="已保存回放数量"');
  });

  it("shows an honest empty state with no fabricated recording", () => {
    const html = render();
    expect(html).toContain("还没有本机回放");
    expect(html).toContain("完成或保存一场对局后");
    // No recording rows and no fabricated frame summary.
    expect(html).not.toContain("replay-record-open");
    expect(html).not.toContain("第 1 /");
  });

  it("states the read-only / local-view honesty boundary", () => {
    const html = render();
    expect(html).toContain("保存在本机的对局画面");
    expect(html).toContain("按当时的玩家视角回看");
  });

  it("renders each stored recording and its delete control", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({ id: "rec-1", title: "夜战" }));
    const html = render({ library, selectedId: "rec-1", selectedFrameIndex: 0 });
    expect(html).toContain("夜战");
    expect(html).toContain('aria-label="查看回放 夜战"');
    expect(html).toContain('aria-label="删除回放 夜战"');
    expect(html).toContain("房间 room-1");
  });

  it("renders a native range input for the frame timeline", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({ id: "rec-1" }));
    const html = render({ library, selectedId: "rec-1", selectedFrameIndex: 1 });
    const range = tagFor(html, "画面范围");
    expect(range).toContain('type="range"');
    expect(range).toContain('min="0"');
    expect(range).toContain('max="1"');
    expect(range).toContain('value="1"');
    expect(html).toContain("第 2 / 2 帧");
  });

  it("disables the next-frame control on the last frame and shows the summary", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({ id: "rec-1" }));
    const html = render({ library, selectedId: "rec-1", selectedFrameIndex: 1 });
    expect(tagFor(html, "下一帧")).toContain("disabled");
    expect(tagFor(html, "上一帧")).not.toContain("disabled");
    // Summary shows the regenerated second frame's real phase.
    expect(html).toContain("当前帧摘要");
  });

  it("clamps a stale selectedFrameIndex instead of rendering out of range", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({ id: "rec-1" }));
    const html = render({ library, selectedId: "rec-1", selectedFrameIndex: 99 });
    expect(tagFor(html, "下一帧")).toContain("disabled");
    expect(html).toContain("第 2 / 2 帧");
    expect(html).not.toContain("第 100");
  });

  it("falls back to the empty timeline when selectedId is unknown", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({ id: "rec-1" }));
    const html = render({ library, selectedId: "missing", selectedFrameIndex: 0 });
    expect(html).toContain("请选择左侧的一场回放");
  });

  it("renders the optional parent viewer slot when provided", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({ id: "rec-1" }));
    const html = render({
      library,
      selectedId: "rec-1",
      selectedFrameIndex: 0,
      viewer: <div data-testid="parent-board">只读牌桌</div>
    });
    expect(html).toContain('data-testid="parent-board"');
    expect(html).toContain("只读牌桌");
    expect(html).not.toContain("未提供牌桌视图");
  });

  it("shows the read-only note so playback never implies a command", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({ id: "rec-1" }));
    const html = render({ library, selectedId: "rec-1", selectedFrameIndex: 0 });
    expect(html).toContain("回放只读");
    expect(html).toContain("不会发送任何对局指令");
  });
});

/*
 * Focus-view contract. The real 2026-10-15 usability gap: at 1280x800 the
 * records list, timeline and summary pushed the board below the fold, so the two
 * mirrored playmats could not be compared on one screen. The fix is a purely
 * local viewing mode that re-hosts the *same* viewer slot on a window-filling
 * layer with a compact toolbar.
 *
 * Only structure and lifecycle are asserted here — the viewer node is rendered
 * exactly once, the list/summary are dropped while expanded, the cursor and the
 * playback controls survive entering and leaving, and the layer cannot exist
 * without a viewer. The parent performs the native pixel A/B check.
 */
describe("ReplayPage table focus view", () => {
  const selectedLibrary = () =>
    saveReplayRecording(emptyReplayLibrary(), recording({
      id: "rec-1",
      frames: [frame("playing", "p1"), frame("changed", "p1")]
    }));

  const board = (marker: string) => <div data-testid={marker}>只读牌桌</div>;

  it("offers no focus control until the parent supplies a viewer", () => {
    const library = selectedLibrary();
    const withoutViewer = render({ library, selectedId: "rec-1", selectedFrameIndex: 0 });
    expect(withoutViewer).not.toContain(`aria-label="${REPLAY_TABLE_FOCUS_ENTER_LABEL}"`);
    // Even an explicit request stays inert without a board to show.
    const requested = render({
      library,
      selectedId: "rec-1",
      selectedFrameIndex: 0,
      initialTableFocus: true
    });
    expect(requested).not.toContain(`aria-label="${REPLAY_TABLE_FOCUS_REGION_LABEL}"`);
    expect(requested).toContain("未提供牌桌视图");
  });

  it("hides the focus control while no recording frame is selected", () => {
    const html = render({ viewer: board("parent-board") });
    expect(html).not.toContain(`aria-label="${REPLAY_TABLE_FOCUS_ENTER_LABEL}"`);
    expect(html).toContain("请选择左侧的一场回放");
  });

  it("keeps the timeline intact and offers the enter control while collapsed", () => {
    const html = render({
      library: selectedLibrary(),
      selectedId: "rec-1",
      selectedFrameIndex: 0,
      viewer: board("parent-board")
    });
    expect(html).toContain('data-table-focus="false"');
    // Collapsed mode keeps the full list, timeline, summary and its viewer slot.
    expect(html).toContain("回放列表");
    expect(html).toContain("当前帧摘要");
    expect(html).toContain('type="range"');
    expect(countOccurrences(html, 'data-testid="parent-board"')).toBe(1);
    expect(html).not.toContain(`aria-label="${REPLAY_TABLE_FOCUS_REGION_LABEL}"`);
    const toggle = tagFor(html, REPLAY_TABLE_FOCUS_ENTER_LABEL);
    expect(toggle).toContain('aria-pressed="false"');
    expect(toggle).toContain("展开牌桌");
  });

  it("expands the single viewer into a window-filling layer and drops the list and summary", () => {
    const html = render({
      library: selectedLibrary(),
      selectedId: "rec-1",
      selectedFrameIndex: 0,
      viewer: board("parent-board"),
      initialTableFocus: true
    });
    expect(html).toContain('data-table-focus="true"');
    expect(html).toContain(`aria-label="${REPLAY_TABLE_FOCUS_REGION_LABEL}"`);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(`aria-label="${REPLAY_TABLE_FOCUS_TOOLBAR_LABEL}"`);
    // The very same viewer node is re-hosted, never duplicated into two boards.
    expect(countOccurrences(html, 'data-testid="parent-board"')).toBe(1);
    expect(countOccurrences(html, 'aria-label="回放牌桌"')).toBe(1);
    // No long list, range slider or summary competes with the board for height.
    expect(html).not.toContain("回放列表");
    expect(html).not.toContain("当前帧摘要");
    expect(html).not.toContain('type="range"');
  });

  it("keeps a compact playback toolbar with prev/next/play, position and an exit control", () => {
    const html = render({
      library: selectedLibrary(),
      selectedId: "rec-1",
      selectedFrameIndex: 1,
      viewer: board("parent-board"),
      initialTableFocus: true
    });
    // Same three cursor controls as the timeline, with the same last-frame gating.
    expect(html).toContain('aria-label="上一帧"');
    expect(tagFor(html, "下一帧")).toContain("disabled");
    expect(html).toContain('aria-label="开始播放"');
    expect(html).toContain("第 2 / 2 帧");
    // Both the header toggle and the toolbar offer a way back out.
    expect(countOccurrences(html, `aria-label="${REPLAY_TABLE_FOCUS_EXIT_LABEL}"`)).toBe(2);
    expect(tagFor(html, REPLAY_TABLE_FOCUS_EXIT_LABEL)).toContain("返回时间轴");
  });

  it("still shows the read-only honesty boundary while focused", () => {
    const html = render({
      library: selectedLibrary(),
      selectedId: "rec-1",
      selectedFrameIndex: 0,
      viewer: board("parent-board"),
      initialTableFocus: true
    });
    expect(html).not.toContain("<form");
    expect(html).not.toContain("提交");
  });

  it("keeps the focus layer inside the fixed window layer, never in page flow", () => {
    const layer = cssBlock(replayPageCss, ".replay-focus");
    expect(layer).toContain("position: fixed");
    expect(layer).toContain("inset: 0");
    expect(layer).toContain("flex-direction: column");
    expect(layer).toMatch(/min-height:\s*0/);
    // The layer must sit below the app's own card preview / art dialogs so a
    // dialog opened from inside the expanded table paints over it, not behind.
    const zIndex = Number(/z-index:\s*(\d+)/.exec(layer)?.[1]);
    expect(zIndex).toBeGreaterThan(0);
    expect(zIndex).toBeLessThan(50);
    // The board takes the leftover height and scrolls inside itself...
    const viewer = cssBlock(replayPageCss, ".replay-focus-viewer");
    expect(viewer).toContain("flex: 1 1 auto");
    expect(viewer).toContain("min-height: 0");
    expect(viewer).toContain("overflow: auto");
    // ...and the toolbar stays a compact single row that cannot grow.
    const toolbar = cssBlock(replayPageCss, ".replay-focus-toolbar");
    expect(toolbar).toContain("flex: none");
    expect(toolbar).toMatch(/flex-wrap:\s*wrap/);
  });

  it("scopes every top-level rule to this page so no other view is affected", () => {
    const selectors = topLevelSelectors(replayPageCss);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const part of selector.split(",")) {
        expect(part.trim().startsWith(".replay-")).toBe(true);
      }
    }
  });
});

describe("ReplayPage table focus helpers", () => {
  it("keeps playback in the existing 900ms cadence", () => {
    expect(REPLAY_PLAYBACK_INTERVAL_MS).toBe(900);
  });

  it("treats only a non-null viewer node as a real board", () => {
    expect(replayViewerAvailable(undefined)).toBe(false);
    expect(replayViewerAvailable(null)).toBe(false);
    expect(replayViewerAvailable(<div />)).toBe(true);
  });

  it("activates the focus layer only with a request, a board and a frame", () => {
    expect(replayTableFocusActive(true, true, true)).toBe(true);
    expect(replayTableFocusActive(false, true, true)).toBe(false);
    expect(replayTableFocusActive(true, false, true)).toBe(false);
    expect(replayTableFocusActive(true, true, false)).toBe(false);
  });
});

describe("ReplayPage phase localization", () => {
  it("maps every known wire phase to its Chinese label", () => {
    expect(replayPhaseLabel("playing", "awaiting-turn-start")).toBe("等待回合开始");
    expect(replayPhaseLabel("playing", "awaken")).toBe("觉醒");
    expect(replayPhaseLabel("playing", "beginning")).toBe("开始");
    expect(replayPhaseLabel("playing", "scoring")).toBe("计分");
    expect(replayPhaseLabel("playing", "channel")).toBe("引导");
    expect(replayPhaseLabel("playing", "draw")).toBe("抽牌");
    expect(replayPhaseLabel("playing", "main")).toBe("主阶段");
    expect(replayPhaseLabel("playing", "ending")).toBe("结束");
    expect(replayPhaseLabel("playing", "expiration")).toBe("失效");
    expect(replayPhaseLabel("playing", "ended")).toBe("已结束");
  });

  it("labels a setup frame as the pre-game phase and keeps a null playing phase explicit", () => {
    expect(replayPhaseLabel("setup", null)).toBe("准备阶段");
    expect(replayPhaseLabel("playing", null)).toBe("—");
  });

  it("falls back to a readable label for an unknown phase instead of the raw token only", () => {
    const label = replayPhaseLabel("playing", "future-phase");
    expect(label).toContain("未知阶段");
    expect(label).toContain("future-phase");
  });
});

describe("ReplayPage roster-name mapping", () => {
  it("reads seat names off the frame's own roster", () => {
    const names = replayRosterNames(namedFrame("changed", "p1", { p1: "夜裔", p2: "晨锋" }));
    expect(names.get("p1")).toBe("夜裔");
    expect(names.get("p2")).toBe("晨锋");
    expect(names.size).toBe(2);
  });

  it("resolves ids, keeps null explicit and never invents a name for an unknown seat", () => {
    const names = replayRosterNames(namedFrame("changed", "p1", { p1: "夜裔", p2: "晨锋" }));
    expect(replayPlayerLabel("p1", names, "旁观")).toBe("夜裔");
    expect(replayPlayerLabel("p2", names, "旁观")).toBe("晨锋");
    expect(replayPlayerLabel(null, names, "旁观")).toBe("旁观");
    expect(replayPlayerLabel(null, names, "无")).toBe("无");
    expect(replayPlayerLabel("p9", names, "旁观")).toBe("p9");
  });

  it("returns an empty mapping when no frame is available", () => {
    expect(replayRosterNames(undefined).size).toBe(0);
  });
});

describe("ReplayPage localized frame summary", () => {
  it("shows Chinese phase and roster names for a playing frame with active priority", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({
      id: "rec-1",
      frames: [namedFrame("changed", "p1", { p1: "夜裔", p2: "晨锋" })]
    }));
    const html = render({ library, selectedId: "rec-1", selectedFrameIndex: 0 });
    expect(html).toContain("主阶段");
    expect(html).not.toContain("main</dd>");
    expect(html).toContain("夜裔");
    expect(html).not.toContain("player-1");
    expect(html).not.toContain("player-2");
  });

  it("shows an explicit spectator view with the null viewer frame", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({
      id: "rec-1",
      frames: [namedFrame("changed", null, { p1: "夜裔", p2: "晨锋" })]
    }));
    const html = render({ library, selectedId: "rec-1", selectedFrameIndex: 0 });
    expect(html).toContain("旁观");
    expect(html).not.toContain("player-1");
  });

  it("regresses the setup frame to the pre-game phase with names, not a raw token", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({
      id: "rec-1",
      frames: [namedFrame("setup", "p1", { p1: "夜裔", p2: "晨锋" })]
    }));
    const html = render({ library, selectedId: "rec-1", selectedFrameIndex: 0 });
    expect(html).toContain("准备阶段");
    expect(html).not.toContain("（未开始 / 组牌）");
    expect(html).toContain("夜裔");
  });

  it("keeps the summary read-only, never a game command surface", () => {
    const library = saveReplayRecording(emptyReplayLibrary(), recording({
      id: "rec-1",
      frames: [namedFrame("changed", "p1", { p1: "夜裔", p2: "晨锋" })]
    }));
    const html = render({ library, selectedId: "rec-1", selectedFrameIndex: 0 });
    expect(html).toContain("回放只读");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("提交");
  });
});
