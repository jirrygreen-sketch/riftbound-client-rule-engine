import type { ReactNode } from "react";
import { ArrowLeft, LogOut, Wifi, WifiOff } from "lucide-react";
import "./AppShell.css";

/**
 * Top-level client pages. `home` is the standalone home menu; every other page
 * is a normal content page rendered inside the shared compact shell.
 * `game-table` is wired by the parent to the real board component.
 */
export type AppPage =
  | "home"
  | "room"
  | "deck-builder"
  | "replays"
  | "profile"
  | "settings"
  | "issue-report"
  | "game-table";

export interface AppShellProps {
  readonly page: AppPage;
  readonly onNavigate: (page: AppPage) => void;
  readonly onExit: () => void;
  readonly children: ReactNode;
  readonly playerName: string;
  readonly connected: boolean;
  readonly inMatch: boolean;
}

/**
 * Page titles shown in the compact shell header. Names match the user-facing
 * home-menu labels so the header never contradicts the entry the user clicked.
 */
export const APP_PAGE_TITLES: Readonly<Record<AppPage, string>> = {
  home: "首页",
  room: "房间连接",
  "deck-builder": "卡组管理",
  replays: "对局回放",
  profile: "个人信息管理",
  settings: "设置",
  "issue-report": "问题上报",
  "game-table": "对局"
};

export function appPageTitle(page: AppPage): string {
  return APP_PAGE_TITLES[page];
}

/**
 * True when the compact bar should offer a jump back to an in-progress match.
 * The home page renders its own continue entry, so the shell never duplicates
 * it on `home`; `game-table` is already the current page.
 */
export function shellShowsResume(page: AppPage, inMatch: boolean): boolean {
  return inMatch && page !== "home" && page !== "game-table";
}

/**
 * Page shell. The home page renders its own full-width layout untouched; every
 * other page gets a short (single-row) bar with a back-to-home control, the
 * page title, live connection/player status, an optional resume button, and a
 * real exit control. The bar stays thin so it does not eat vertical space, and
 * the body owns its own scrolling instead of growing the page.
 */
export function AppShell({
  page,
  onNavigate,
  onExit,
  children,
  playerName,
  connected,
  inMatch
}: AppShellProps) {
  if (page === "home") {
    return (
      <div className="rb-shell rb-shell--home" data-page={page}>
        {children}
      </div>
    );
  }

  const title = appPageTitle(page);

  return (
    <div className="rb-shell" data-page={page}>
      <header className="rb-shell-bar">
        <button
          type="button"
          className="rb-shell-back"
          onClick={() => onNavigate("home")}
        >
          <ArrowLeft size={16} aria-hidden />
          返回首页
        </button>
        <h1 className="rb-shell-title">{title}</h1>
        <div className="rb-shell-meta">
          {shellShowsResume(page, inMatch) ? (
            <button
              type="button"
              className="rb-shell-resume"
              onClick={() => onNavigate("game-table")}
            >
              返回对局
            </button>
          ) : null}
          <span
            className={`rb-shell-conn ${connected ? "is-on" : "is-off"}`}
            role="status"
            aria-live="polite"
          >
            {connected ? (
              <Wifi size={14} aria-hidden />
            ) : (
              <WifiOff size={14} aria-hidden />
            )}
            {connected ? "已连接" : "未连接"}
          </span>
          <span className="rb-shell-player" title={playerName}>
            {playerName}
          </span>
          <button type="button" className="rb-shell-exit" onClick={onExit}>
            <LogOut size={14} aria-hidden />
            退出
          </button>
        </div>
      </header>
      <div className="rb-shell-body" aria-label={title}>
        {children}
      </div>
    </div>
  );
}
