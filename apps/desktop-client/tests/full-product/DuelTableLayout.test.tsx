import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_ACTION_PANEL_LABEL,
  DUEL_ACTIVITY_LOG_LABEL,
  DUEL_BATTLEFIELDS_LABEL,
  DUEL_CHAT_LABEL,
  DUEL_CHAT_TAB_LABEL,
  DUEL_COMMS_LABEL,
  DUEL_CONTROLS_LABEL,
  DUEL_HAND_LABEL,
  DUEL_LOG_TAB_LABEL,
  DUEL_OPPONENT_BASE_LABEL,
  DUEL_OPPONENT_HAND_LABEL,
  DUEL_PLAYER_BASE_LABEL,
  DUEL_RESOURCE_POOL_LABEL,
  DUEL_SCOREBOARD_LABEL,
  DUEL_TABLE_LABEL,
  DUEL_TIMING_LABEL,
  DUEL_TOOLBAR_LABEL,
  DuelTableLayout
} from "../../src/full-product/components/DuelTableLayout";
import type { DuelTableLayoutProps } from "../../src/full-product/components/DuelTableLayout";

const render = (props: DuelTableLayoutProps): string =>
  renderToStaticMarkup(<DuelTableLayout {...props} />);

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const fullSlots: DuelTableLayoutProps = {
  header: <span data-probe="header">组件布局样例</span>,
  scoreboard: <span data-probe="score">0 / 8</span>,
  opponentHand: <span data-probe="opponent-hand">对手手牌 5 张（背面）</span>,
  opponentBase: <span data-probe="opponent">对手基地区域</span>,
  battlefields: <span data-probe="battlefields">战场 A · 战场 B</span>,
  playerBase: <span data-probe="player">我方基地区域</span>,
  resourcePool: <span data-probe="resource">资源池 3/3</span>,
  hand: <span data-probe="hand">手牌 5 张</span>,
  actionPanel: <span data-probe="actions">可用动作</span>,
  activityLog: <span data-probe="log">日志：组件布局样例</span>
};

describe("DuelTableLayout shell", () => {
  it("places each slot in its labeled region with the top-to-bottom table order", () => {
    const html = render(fullSlots);

    // Every slot lands inside its semantic region.
    expect(html).toContain(`aria-label="${DUEL_OPPONENT_BASE_LABEL}"`);
    expect(html).toContain(`aria-label="${DUEL_BATTLEFIELDS_LABEL}"`);
    expect(html).toContain(`aria-label="${DUEL_PLAYER_BASE_LABEL}"`);
    expect(html).toContain(`aria-label="${DUEL_RESOURCE_POOL_LABEL}"`);
    expect(html).toContain(`aria-label="${DUEL_HAND_LABEL}"`);
    expect(html).toContain(`aria-label="${DUEL_SCOREBOARD_LABEL}"`);
    expect(html).toContain(`aria-label="${DUEL_ACTION_PANEL_LABEL}"`);
    expect(html).toContain(`aria-label="${DUEL_ACTIVITY_LOG_LABEL}"`);

    const at = (marker: string) => html.indexOf(marker);
    // Central column order: opponent base -> battlefields -> own base ->
    // resource pool -> hand, exactly as requested (top/middle/bottom stack).
    expect(at('data-probe="opponent"')).toBeGreaterThan(-1);
    expect(at('data-probe="opponent"')).toBeLessThan(at('data-probe="battlefields"'));
    expect(at('data-probe="battlefields"')).toBeLessThan(at('data-probe="player"'));
    expect(at('data-probe="player"')).toBeLessThan(at('data-probe="resource"'));
    expect(at('data-probe="resource"')).toBeLessThan(at('data-probe="hand"'));

    // Score rail sits left of the table; the sidebar sits right of it.
    expect(at('data-probe="score"')).toBeLessThan(at('data-probe="opponent"'));
    expect(at('data-probe="hand"')).toBeLessThan(at('data-probe="actions"'));
    expect(at('data-probe="actions"')).toBeLessThan(at('data-probe="log"'));

    // Each slot is rendered exactly once (no duplication into other regions).
    for (const probe of [
      "header",
      "score",
      "opponent",
      "battlefields",
      "player",
      "resource",
      "hand",
      "actions",
      "log"
    ]) {
      expect(count(html, `data-probe="${probe}"`)).toBe(1);
    }
  });

  it("keeps landmarks stable but fabricates no control when slots are empty", () => {
    const html = render({});

    // Region landmarks remain, so an unwired adapter still yields a readable
    // structure.
    expect(html).toContain(`aria-label="${DUEL_TABLE_LABEL}"`);
    expect(html).toContain(`aria-label="${DUEL_SCOREBOARD_LABEL}"`);
    expect(html).toContain(`aria-label="${DUEL_ACTION_PANEL_LABEL}"`);
    expect(html).toContain(`aria-label="${DUEL_ACTIVITY_LOG_LABEL}"`);
    expect(html).toContain(`aria-label="${DUEL_RESOURCE_POOL_LABEL}"`);

    // Empty slots never conjure a button, input, or action.
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="button"');
    // The optional toolbar is omitted, not synthesized.
    expect(html).not.toContain(DUEL_TOOLBAR_LABEL);
  });

  it("forwards slot content and callbacks verbatim without becoming game state", () => {
    const onClick = vi.fn();
    const action = (
      <button type="button" data-probe="action-a" onClick={onClick}>
        执行动作
      </button>
    );
    const html = render({ ...fullSlots, actionPanel: action });

    // Content passes through unchanged.
    expect(html).toContain(renderToStaticMarkup(action));
    expect(html).toContain("执行动作");

    // Rendering the layout never invokes a caller's callback and the shell keeps
    // no state: two renders of the same props are byte-identical.
    expect(onClick).not.toHaveBeenCalled();
    expect(render({ ...fullSlots, actionPanel: action })).toBe(html);

    // The forwarded action stays inside the action-panel region, after the
    // scoreboard/table and before the log, with no perspective inference.
    const actionAt = html.indexOf('data-probe="action-a"');
    expect(actionAt).toBeGreaterThan(html.indexOf(`aria-label="${DUEL_ACTION_PANEL_LABEL}"`));
    expect(actionAt).toBeLessThan(html.indexOf(`aria-label="${DUEL_ACTIVITY_LOG_LABEL}"`));
  });
});

// Added by duel-table-zones-layout: the three new optional slots (timing,
// controls, chat) plus the chat/log sidebar tab selector. The legacy slot-order
// assertions above are unchanged.

describe("DuelTableLayout timing/controls/chat slots", () => {
  it("renders the optional timing and controls strips only when supplied", () => {
    const withStrips = render({
      ...fullSlots,
      timing: <span data-probe="timing">优先权：你</span>,
      controls: <select data-probe="controls" defaultValue="a" />,
    });

    expect(withStrips).toContain(`aria-label="${DUEL_TIMING_LABEL}"`);
    expect(withStrips).toContain(`aria-label="${DUEL_CONTROLS_LABEL}"`);
    expect(withStrips).toContain('data-probe="timing"');
    expect(withStrips).toContain('data-probe="controls"');

    // Timing and settings occupy the side rail, before commands and chat.
    const at = (marker: string) => withStrips.indexOf(marker);
    expect(at('data-probe="score"')).toBeLessThan(at('data-probe="timing"'));
    expect(at('data-probe="opponent"')).toBeLessThan(at('data-probe="timing"'));
    expect(at('data-probe="timing"')).toBeLessThan(at('data-probe="actions"'));
    expect(at('data-probe="controls"')).toBeLessThan(at('data-probe="actions"'));

    // Absent slots render no timing/controls region and no fabricated control.
    const withoutStrips = render(fullSlots);
    expect(withoutStrips).not.toContain(`aria-label="${DUEL_TIMING_LABEL}"`);
    expect(withoutStrips).not.toContain(`aria-label="${DUEL_CONTROLS_LABEL}"`);
  });

  it("shows chat by default and the activity log when no chat is supplied", () => {
    // chat supplied, log absent: default communications panel is the chat.
    const chatOnly = render({
      ...fullSlots,
      activityLog: undefined,
      chat: <span data-probe="chat">房间消息</span>
    });
    expect(chatOnly).toContain(`aria-label="${DUEL_CHAT_LABEL}"`);
    expect(chatOnly).toContain('data-probe="chat"');
    expect(chatOnly).not.toContain(`aria-label="${DUEL_ACTIVITY_LOG_LABEL}"`);
    // No tab switcher when only one panel exists.
    expect(chatOnly).not.toContain('role="tablist"');

    // chat absent: default communications panel is the activity log.
    const logOnly = render({ ...fullSlots, chat: undefined });
    expect(logOnly).toContain(`aria-label="${DUEL_ACTIVITY_LOG_LABEL}"`);
    expect(logOnly).toContain('data-probe="log"');
    expect(logOnly).not.toContain(`aria-label="${DUEL_CHAT_LABEL}"`);

    // Both supplied: a tablist is shown and the chat is the default selection.
    const both = render({
      ...fullSlots,
      chat: <span data-probe="chat">房间消息</span>
    });
    expect(both).toContain(`aria-label="${DUEL_COMMS_LABEL}"`);
    expect(both).toContain(`role="tablist"`);
    expect(both).toContain(`>${DUEL_CHAT_TAB_LABEL}</button>`);
    expect(both).toContain(`>${DUEL_LOG_TAB_LABEL}</button>`);
    expect(both).toContain('data-probe="chat"');
    // The unselected log panel is not rendered (selection only shows one).
    expect(both).not.toContain('data-probe="log"');
  });

  it("keeps legal actions visible regardless of the communications panel", () => {
    const html = render({
      ...fullSlots,
      actionPanel: <button type="button" data-probe="legal">可用动作</button>,
      chat: <span data-probe="chat">房间消息</span>
    });
    expect(html).toContain(`aria-label="${DUEL_ACTION_PANEL_LABEL}"`);
    expect(html).toContain('data-probe="legal"');
    // The action region is never replaced by the comms tabs.
    const actionAt = html.indexOf('data-probe="legal"');
    expect(actionAt).toBeGreaterThan(html.indexOf(`aria-label="${DUEL_ACTION_PANEL_LABEL}"`));
    expect(actionAt).toBeLessThan(html.indexOf(`aria-label="${DUEL_CHAT_LABEL}"`));
  });
});


describe("payment resource placement", () => {
  it("moves the sole resource surface next to actions and leaves the hand alone", () => {
    const html = render({ ...fullSlots, resourcePlacement: "actions" });
    expect(count(html, 'data-probe="resource"')).toBe(1);
    expect(count(html, 'data-probe="actions"')).toBe(1);
    expect(html).toContain("full-product-duel-table-payment");
    expect(html.indexOf('data-probe="hand"')).toBeLessThan(html.indexOf('data-probe="resource"'));
    expect(html.indexOf('data-probe="resource"')).toBeLessThan(html.indexOf('data-probe="actions"'));
    expect(html).not.toContain('class="full-product-duel-table-resources"');
  });
});

describe("playmat hand regions", () => {
  it("keeps opponent backs above its base and our hand below our base", () => {
    const html = render({ ...fullSlots, resourcePlacement: "sidebar" });
    expect(html).toContain(`aria-label="${DUEL_OPPONENT_HAND_LABEL}"`);
    const at = (probe: string) => html.indexOf(`data-probe="${probe}"`);
    expect(at("opponent-hand")).toBeLessThan(at("opponent"));
    expect(at("opponent")).toBeLessThan(at("battlefields"));
    expect(at("battlefields")).toBeLessThan(at("player"));
    expect(at("player")).toBeLessThan(at("hand"));
    expect(at("hand")).toBeLessThan(at("resource"));
    for (const probe of ["opponent-hand", "hand", "resource"]) expect(count(html, `data-probe="${probe}"`)).toBe(1);
  });
});
