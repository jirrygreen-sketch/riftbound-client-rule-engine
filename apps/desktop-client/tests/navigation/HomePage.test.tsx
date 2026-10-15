import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  AppShell,
  APP_PAGE_TITLES,
  appPageTitle,
  shellShowsResume,
  type AppPage,
  type AppShellProps
} from "../../src/navigation/AppShell";
import {
  HomePage,
  homeMenuEntries,
  type HomePageProps
} from "../../src/navigation/HomePage";

const HOME_PROPS: HomePageProps = {
  onNavigate: () => {},
  onExit: () => {},
  playerName: "玩家",
  connected: true,
  inMatch: false,
  roomId: null,
  deckCount: 0
};

function renderHome(overrides: Partial<HomePageProps> = {}): string {
  return renderToStaticMarkup(<HomePage {...HOME_PROPS} {...overrides} />);
}

function renderShell(overrides: Partial<AppShellProps> = {}): string {
  const props: AppShellProps = {
    page: "room",
    onNavigate: () => {},
    onExit: () => {},
    children: <p>内容</p>,
    playerName: "玩家",
    connected: true,
    inMatch: false,
    ...overrides
  };
  return renderToStaticMarkup(<AppShell {...props} />);
}

/** Opening tag of the button that carries the given label text. */
function buttonTagFor(markup: string, label: string): string {
  const labelIndex = markup.indexOf(label);
  if (labelIndex < 0) throw new Error(`button label not found: ${label}`);
  const start = markup.lastIndexOf("<button", labelIndex);
  if (start < 0) throw new Error(`button tag not found for: ${label}`);
  return markup.slice(start, markup.indexOf(">", start) + 1);
}

describe("home menu entries (pure model)", () => {
  it("exposes exactly the six user-named entries in order", () => {
    expect(homeMenuEntries({ connected: true }).map(entry => entry.label)).toEqual([
      "房间连接",
      "卡组管理",
      "对局回放",
      "个人信息管理",
      "退出",
      "设置"
    ]);
  });

  it("routes the five non-exit entries to their real pages", () => {
    const entries = homeMenuEntries({ connected: true });
    const byLabel = Object.fromEntries(entries.map(entry => [entry.label, entry]));
    expect(byLabel["房间连接"]?.page).toBe("room");
    expect(byLabel["卡组管理"]?.page).toBe("deck-builder");
    expect(byLabel["对局回放"]?.page).toBe("replays");
    expect(byLabel["个人信息管理"]?.page).toBe("profile");
    expect(byLabel["设置"]?.page).toBe("settings");
    expect(byLabel["退出"]?.kind).toBe("exit");
  });

  it("enables every entry while connected", () => {
    for (const entry of homeMenuEntries({ connected: true })) {
      expect(entry.disabled, entry.label).toBe(false);
    }
  });

  it("keeps local replay and management entries available while disconnected", () => {
    const entries = homeMenuEntries({ connected: false });
    const disabled = entries.filter(entry => entry.disabled).map(entry => entry.label);
    expect(disabled).toEqual([]);
    const replay = entries.find(entry => entry.id === "replays");
    expect(replay?.disabled).toBe(false);
  });

  it("never fabricates a disabled state on the exit action", () => {
    const exit = homeMenuEntries({ connected: false }).find(entry => entry.id === "exit");
    expect(exit?.disabled).toBe(false);
    expect(exit?.kind).toBe("exit");
  });
});

describe("HomePage SSR", () => {
  it("renders all six real menu labels", () => {
    const markup = renderHome();
    for (const label of [
      "房间连接",
      "卡组管理",
      "对局回放",
      "个人信息管理",
      "退出",
      "设置"
    ]) {
      expect(markup).toContain(label);
    }
  });

  it("does not disable every entry while connected", () => {
    const markup = renderHome({ connected: true });
    expect(markup.match(/<button type="button" class="rb-home-card"[^>]*disabled/g)).toBeNull();
  });

  it("keeps the replay card usable offline", () => {
    expect(buttonTagFor(renderHome({ connected: false }), "对局回放")).not.toContain("disabled");
    expect(buttonTagFor(renderHome({ connected: false }), "房间连接")).not.toContain("disabled");
    expect(buttonTagFor(renderHome({ connected: false }), "设置")).not.toContain("disabled");
  });

  it("shows the player identity and live connection state", () => {
    const markup = renderHome({ playerName: "莉娜", connected: true });
    expect(markup).toContain("莉娜");
    expect(markup).toContain("已连接服务器");
    expect(renderHome({ connected: false })).toContain("未连接服务器");
  });

  it("shows the room id and deck count from props", () => {
    const markup = renderHome({ roomId: "room-42", deckCount: 7 });
    expect(markup).toContain("room-42");
    expect(markup).toContain(">7<");
  });

  it("falls back to an empty-room label when no room is joined", () => {
    expect(renderHome({ roomId: null })).toContain("未加入房间");
  });

  it("shows the continue-match action only while a match is in progress", () => {
    expect(renderHome({ inMatch: false })).not.toContain("继续对局");
    expect(renderHome({ inMatch: true })).toContain("继续对局");
  });

  it("renders the sidebar and menu grid regions, not a single stacked column", () => {
    const markup = renderHome();
    expect(markup).toContain('class="rb-home"');
    expect(markup).toContain('aria-label="玩家与连接状态"');
    expect(markup).toContain('aria-label="首页菜单"');
  });
});

describe("AppShell compact page shell", () => {
  it("titles every non-home page with its real menu name", () => {
    expect(appPageTitle("deck-builder")).toBe("卡组管理");
    expect(appPageTitle("replays")).toBe("对局回放");
    expect(appPageTitle("profile")).toBe("个人信息管理");
    expect(appPageTitle("settings")).toBe("设置");
    expect(appPageTitle("room")).toBe("房间连接");
    expect(APP_PAGE_TITLES.home).toBe("首页");
  });

  it("renders a back-to-home control, the page title and the children on content pages", () => {
    const markup = renderShell({ page: "replays" });
    expect(markup).toContain("返回首页");
    expect(markup).toContain("对局回放");
    expect(markup).toContain("内容");
    expect(markup).toContain('<div class="rb-shell-body" aria-label="对局回放">');
  });

  it("does not render its own chrome on the home page", () => {
    const markup = renderShell({ page: "home", children: <div>首页内容</div> });
    expect(markup).toContain("首页内容");
    expect(markup).not.toContain("返回首页");
    expect(markup).not.toContain("rb-shell-bar");
  });

  it("exposes a real exit control on content pages", () => {
    expect(renderShell({ page: "settings" })).toContain(">退出<");
  });

  it("decides the resume entry from page and match state", () => {
    expect(shellShowsResume("room", true)).toBe(true);
    expect(shellShowsResume("room", false)).toBe(false);
    expect(shellShowsResume("home", true)).toBe(false);
    expect(shellShowsResume("game-table", true)).toBe(false);
  });

  it("adds the resume entry in the bar only while a match is live off the table", () => {
    expect(renderShell({ page: "room", inMatch: true })).toContain("返回对局");
    expect(renderShell({ page: "room", inMatch: false })).not.toContain("返回对局");
    expect(renderShell({ page: "game-table", inMatch: true })).not.toContain("返回对局");
  });

  it("reports connection state in the bar", () => {
    expect(renderShell({ page: "room", connected: true })).toContain("已连接");
    expect(renderShell({ page: "room", connected: false })).toContain("未连接");
  });

  it("never invents pages outside the declared AppPage union", () => {
    const pages: readonly AppPage[] = [
      "home",
      "room",
      "deck-builder",
      "replays",
      "profile",
      "settings",
      "game-table"
    ];
    for (const page of pages) {
      expect(() => renderShell({ page })).not.toThrow();
    }
  });
});
