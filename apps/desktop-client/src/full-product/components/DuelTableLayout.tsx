import { useState } from "react";
import type { ReactNode } from "react";
import "./DuelTableLayout.css";

/**
 * Reusable, purely presentational Duel table shell.
 *
 * Every content-bearing prop is a `ReactNode` slot supplied by the caller. This
 * layout owns no game data: it never holds or derives a balance, phase, unit,
 * location, controller, or viewing perspective. The Duel adapter maps the
 * authoritative server projection onto these exact slots; the shell only
 * arranges them and labels the regions.
 *
 * Perspective is deliberately not inferred here. The adapter decides which real
 * side is the top band (`opponentBase`) and which is the bottom band
 * (`playerBase`); the shell renders them in the given order and never relabels
 * a side as "ours".
 *
 * The only local state is which communication tab is on screen (`chat` or
 * `activityLog`). It selects between caller-supplied panels and never derives,
 * caches or fabricates game data — legal actions stay visible in the always-on
 * `actionPanel` region.
 *
 * Empty slots are allowed. An omitted slot renders its region empty and never
 * fabricates a placeholder button, cost, card, or action.
 */

export const DUEL_TABLE_LABEL = "对局桌面";
export const DUEL_TOOLBAR_LABEL = "对局工具栏";
export const DUEL_TIMING_LABEL = "时点提示";
export const DUEL_CONTROLS_LABEL = "局内配置";
export const DUEL_SCOREBOARD_LABEL = "计分轨";
export const DUEL_OPPONENT_BASE_LABEL = "对手基地";
export const DUEL_OPPONENT_HAND_LABEL = "对手手牌";
export const DUEL_BATTLEFIELDS_LABEL = "中央战场";
export const DUEL_PLAYER_BASE_LABEL = "我方基地";
export const DUEL_RESOURCE_POOL_LABEL = "资源池";
export const DUEL_HAND_LABEL = "手牌";
export const DUEL_ACTION_PANEL_LABEL = "操作面板";
export const DUEL_COMMS_LABEL = "聊天与日志";
export const DUEL_CHAT_LABEL = "对局聊天";
export const DUEL_ACTIVITY_LOG_LABEL = "对局日志";
export const DUEL_CHAT_TAB_LABEL = "聊天";
export const DUEL_LOG_TAB_LABEL = "日志";

/** Which caller-supplied communication panel the sidebar shows. */
export type DuelTableCommTab = "chat" | "log";

export interface DuelTableLayoutProps {
  /** Optional top toolbar slot (turn/connection titles, navigation, settings). */
  readonly header?: ReactNode;
  /** Left/top score slot, e.g. the victory score track. */
  readonly scoreboard?: ReactNode;
  /** Fixed timing-window strip slot (e.g. the server-projected window status). */
  readonly timing?: ReactNode;
  /** In-match configuration slot (view/table preferences supplied by the caller). */
  readonly controls?: ReactNode;
  /** Top band: the adapter-chosen opposing side's base. */
  readonly opponentBase?: ReactNode;
  /** Public card backs/count only; the adapter never supplies hidden identities. */
  readonly opponentHand?: ReactNode;
  /** Central area: the shared battlefields. */
  readonly battlefields?: ReactNode;
  /** Bottom band: the adapter-chosen own side's base. */
  readonly playerBase?: ReactNode;
  /** Our-side resource pool. */
  readonly resourcePool?: ReactNode;
  /** Presentation only: place the single resource surface beside a payment. */
  readonly resourcePlacement?: "bottom" | "sidebar" | "actions";
  /** Bottom band: the hand. */
  readonly hand?: ReactNode;
  /** Right sidebar: legal actions / prompt controls. Never hidden by the tabs. */
  readonly actionPanel?: ReactNode;
  /** Right sidebar: the table chat. Shown by default when supplied. */
  readonly chat?: ReactNode;
  /** Right sidebar: the public activity log. Shown when no chat is supplied. */
  readonly activityLog?: ReactNode;
}

export function DuelTableLayout({
  header,
  scoreboard,
  timing,
  controls,
  opponentBase,
  opponentHand,
  battlefields,
  playerBase,
  resourcePool,
  resourcePlacement = "bottom",
  hand,
  actionPanel,
  chat,
  activityLog
}: DuelTableLayoutProps) {
  const hasChat = chat !== undefined && chat !== null;
  const hasLog = activityLog !== undefined && activityLog !== null;
  const showTabs = hasChat && hasLog;
  const [commTab, setCommTab] = useState<DuelTableCommTab>(hasChat ? "chat" : "log");
  // The caller-supplied default is chat when present, otherwise the log. A tab
  // click only re-selects between the two supplied panels.
  const selectedTab: DuelTableCommTab = showTabs ? commTab : hasChat ? "chat" : "log";

  return (
    <div
      className={`full-product-duel-table${resourcePlacement !== "bottom" ? " full-product-duel-table-side-pool" : ""}${resourcePlacement === "actions" ? " full-product-duel-table-payment" : ""}`}
      role="region"
      aria-label={DUEL_TABLE_LABEL}
    >
      <div className="full-product-duel-table-top">
        {header ? (
          <div
            className="full-product-duel-table-toolbar"
            role="region"
            aria-label={DUEL_TOOLBAR_LABEL}
          >
            {header}
          </div>
        ) : null}
        <div
          className="full-product-duel-table-scoreboard"
          role="region"
          aria-label={DUEL_SCOREBOARD_LABEL}
        >
          {scoreboard}
        </div>
      </div>
      <div className="full-product-duel-table-body">
        <div className="full-product-duel-table-main">
          <section className="full-product-duel-table-opponent-hand" role="region" aria-label={DUEL_OPPONENT_HAND_LABEL}>
            {opponentHand}
          </section>
          <section
            className="full-product-duel-table-band full-product-duel-table-opponent"
            role="region"
            aria-label={DUEL_OPPONENT_BASE_LABEL}
          >
            {opponentBase}
          </section>
          <section
            className="full-product-duel-table-central"
            role="region"
            aria-label={DUEL_BATTLEFIELDS_LABEL}
          >
            {battlefields}
          </section>
          <section
            className="full-product-duel-table-band full-product-duel-table-player"
            role="region"
            aria-label={DUEL_PLAYER_BASE_LABEL}
          >
            {playerBase}
          </section>
          {resourcePlacement === "bottom" ? (
            <section className="full-product-duel-table-resources" role="region" aria-label={DUEL_RESOURCE_POOL_LABEL}>
              {resourcePool}
            </section>
          ) : null}
          <section
            className="full-product-duel-table-hand"
            role="region"
            aria-label={DUEL_HAND_LABEL}
          >
            {hand}
          </section>
        </div>
        <aside className="full-product-duel-table-sidebar">
          {timing ? <div className="full-product-duel-table-timing" role="region" aria-label={DUEL_TIMING_LABEL}>{timing}</div> : null}
          {controls ? <div className="full-product-duel-table-controls" role="region" aria-label={DUEL_CONTROLS_LABEL}>{controls}</div> : null}
          <section
            className="full-product-duel-table-actions"
            role="region"
            aria-label={DUEL_ACTION_PANEL_LABEL}
          >
            {resourcePlacement !== "bottom" ? (
              <section className={resourcePlacement === "actions" ? "full-product-duel-table-payment-resources" : "full-product-duel-table-side-resources"} role="region" aria-label={DUEL_RESOURCE_POOL_LABEL}>
                {resourcePool}
              </section>
            ) : null}
            {actionPanel}
          </section>
          <div className="full-product-duel-table-comms">
            {showTabs ? (
              <div
                className="full-product-duel-table-comms-tabs"
                role="tablist"
                aria-label={DUEL_COMMS_LABEL}
              >
                <button
                  type="button"
                  role="tab"
                  className="full-product-duel-table-comms-tab"
                  aria-selected={selectedTab === "chat"}
                  onClick={() => setCommTab("chat")}
                >
                  {DUEL_CHAT_TAB_LABEL}
                </button>
                <button
                  type="button"
                  role="tab"
                  className="full-product-duel-table-comms-tab"
                  aria-selected={selectedTab === "log"}
                  onClick={() => setCommTab("log")}
                >
                  {DUEL_LOG_TAB_LABEL}
                </button>
              </div>
            ) : null}
            {selectedTab === "chat" && hasChat ? (
              <section
                className="full-product-duel-table-chat"
                role="region"
                aria-label={DUEL_CHAT_LABEL}
              >
                {chat}
              </section>
            ) : null}
            {selectedTab === "log" ? (
              <section
                className="full-product-duel-table-log"
                role="region"
                aria-label={DUEL_ACTIVITY_LOG_LABEL}
              >
                {activityLog}
              </section>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
