import {
  Cable,
  Layers,
  Film,
  UserCircle,
  LogOut,
  Settings,
  MessageSquareWarning,
  Play,
  Wifi,
  WifiOff
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AppPage } from "./AppShell";
import "./HomePage.css";

export interface HomePageProps {
  readonly onNavigate: (page: AppPage) => void;
  readonly onExit: () => void;
  readonly playerName: string;
  readonly connected: boolean;
  readonly inMatch: boolean;
  readonly roomId: string | null;
  readonly deckCount: number;
}

/**
 * A single home-menu entry. `navigate` entries move the shell to `page`;
 * `exit` entries are real actions (a callback), never a decorative link.
 */
export interface HomeMenuEntry {
  readonly id: "room" | "deck-builder" | "replays" | "profile" | "exit" | "settings" | "issue-report";
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly kind: "navigate" | "exit";
  readonly page?: AppPage;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}

export const ISSUE_REPORT_HOME_ENTRY: HomeMenuEntry = Object.freeze({
  id: "issue-report",
  label: "问题上报",
  description: "提交问题描述和本地诊断日志",
  icon: MessageSquareWarning,
  kind: "navigate",
  page: "issue-report",
  disabled: false
});

/**
 * Pure model for the six legacy home-menu entries. The production page appends
 * the issue-report action separately so existing navigation contracts remain
 * stable. Disabled state is computed from the passed-in projection only; the
 * component never disables every entry.
 *
 * Every menu stays usable offline. Replays and profile/settings are local;
 * the room page provides the actual server connection workflow.
 */
export function homeMenuEntries(options: {
  readonly connected: boolean;
}): readonly HomeMenuEntry[] {
  void options;
  return [
    {
      id: "room",
      label: "房间连接",
      description: "连接服务器、创建或加入房间",
      icon: Cable,
      kind: "navigate",
      page: "room",
      disabled: false
    },
    {
      id: "deck-builder",
      label: "卡组管理",
      description: "编辑并保存本地卡组",
      icon: Layers,
      kind: "navigate",
      page: "deck-builder",
      disabled: false
    },
    {
      id: "replays",
      label: "对局回放",
      description: "回看已结束的对局记录",
      icon: Film,
      kind: "navigate",
      page: "replays",
      disabled: false
    },
    {
      id: "profile",
      label: "个人信息管理",
      description: "查看与修改个人资料",
      icon: UserCircle,
      kind: "navigate",
      page: "profile",
      disabled: false
    },
    {
      id: "exit",
      label: "退出",
      description: "退出当前会话并关闭桌面客户端",
      icon: LogOut,
      kind: "exit",
      disabled: false
    },
    {
      id: "settings",
      label: "设置",
      description: "调整客户端偏好与显示选项",
      icon: Settings,
      kind: "navigate",
      page: "settings",
      disabled: false
    }
  ];
}

/**
 * Standalone, spacious home page: a two-column layout with an identity/status
 * sidebar on the left and a menu-card grid on the right. This deliberately is
 * not the old "three tabs with everything stacked" surface. The optional
 * continue-match entry is shown only while a match is actually in progress.
 */
export function HomePage({
  onNavigate,
  onExit,
  playerName,
  connected,
  inMatch,
  roomId,
  deckCount
}: HomePageProps) {
  const entries = [...homeMenuEntries({ connected }), ISSUE_REPORT_HOME_ENTRY];

  return (
    <div className="rb-home">
      <aside className="rb-home-sidebar" aria-label="玩家与连接状态">
        <div className="rb-home-identity">
          <UserCircle size={44} aria-hidden />
          <div>
            <h2 className="rb-home-player" title={playerName}>
              {playerName}
            </h2>
            <span
              className={`rb-home-conn ${connected ? "is-on" : "is-off"}`}
              role="status"
              aria-live="polite"
            >
              {connected ? <Wifi size={14} aria-hidden /> : <WifiOff size={14} aria-hidden />}
              {connected ? "已连接服务器" : "未连接服务器"}
            </span>
          </div>
        </div>

        <dl className="rb-home-stats">
          <div>
            <dt>当前房间</dt>
            <dd title={roomId ?? ""}>{roomId ?? "未加入房间"}</dd>
          </div>
          <div>
            <dt>卡组数量</dt>
            <dd>{`${deckCount}`}</dd>
          </div>
        </dl>

        {inMatch ? (
          <button
            type="button"
            className="rb-home-continue"
            onClick={() => onNavigate("game-table")}
          >
            <Play size={16} aria-hidden />
            继续对局
          </button>
        ) : null}
      </aside>

      <div className="rb-home-main">
        <header className="rb-home-hero">
          <h1>Riftbound</h1>
          <p>选择下方入口开始你的对局体验</p>
        </header>

        <nav className="rb-home-menu" aria-label="首页菜单">
          {entries.map(entry => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                className="rb-home-card"
                data-entry={entry.id}
                disabled={entry.disabled}
                title={entry.disabled ? entry.disabledReason : entry.description}
                onClick={() => {
                  if (entry.kind === "exit") {
                    onExit();
                    return;
                  }
                  if (entry.page) onNavigate(entry.page);
                }}
              >
                <span className="rb-home-card-icon" aria-hidden>
                  <Icon size={22} />
                </span>
                <span className="rb-home-card-body">
                  <span className="rb-home-card-label">{entry.label}</span>
                  <span className="rb-home-card-desc">
                    {entry.disabled ? entry.disabledReason : entry.description}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
