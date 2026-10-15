import { useState } from "react";
import "./SettingsPage.css";
import { CARD_SCALE_OPTIONS, type DisplaySettings } from "./display-settings";

/**
 * In-match controls: an expandable gear panel for the local display settings
 * plus match navigation and an optional concede action.
 *
 * This component never guesses game state. It only renders the display
 * preferences it is given and reports intended changes through `onChange`.
 * `onGoHome` / `onGoRoom` navigate the shell; they do not end the match. The
 * concede action is rendered only when the caller supplies `onConcede`, and it
 * is operable only while the caller reports `canConcede === true`; when no
 * `onConcede` is given this component does not fabricate a fake concede button.
 */

export const MATCH_CONTROLS_LABEL = "对局控制";
export const MATCH_GEAR_SUMMARY_LABEL = "显示与对局设置";
export const MATCH_CONCEDE_LABEL = "认输";
export const MATCH_CONCEDE_CONFIRM_LABEL = "确认认输";
export const MATCH_CONCEDE_CANCEL_LABEL = "取消";
export const MATCH_GO_HOME_LABEL = "返回首页";
export const MATCH_GO_ROOM_LABEL = "返回房间";

export type ConcedeRequestOutcome = "ignore" | "confirm" | "concede";

/**
 * Pure decision for what a concede click should do, so the two-step behavior is
 * testable without a DOM. `ignore` means there is no authorized action (no
 * handler, or the caller did not report `canConcede`); `confirm` opens the
 * two-step confirmation; `concede` submits directly.
 */
export function resolveConcedeRequest(input: {
  readonly hasConcedeAction: boolean;
  readonly canConcede: boolean;
  readonly confirmConcede: boolean;
}): ConcedeRequestOutcome {
  if (!input.hasConcedeAction || !input.canConcede) return "ignore";
  return input.confirmConcede ? "confirm" : "concede";
}

export interface MatchControlsProps {
  readonly settings: DisplaySettings;
  readonly onChange: (next: DisplaySettings) => void;
  readonly onGoHome: () => void;
  readonly onGoRoom: () => void;
  readonly onConcede?: () => void;
  readonly canConcede?: boolean;
}

export function MatchControls({
  settings,
  onChange,
  onGoHome,
  onGoRoom,
  onConcede,
  canConcede = false
}: MatchControlsProps) {
  const [confirmingConcede, setConfirmingConcede] = useState(false);
  const update = (patch: Partial<DisplaySettings>) => onChange({ ...settings, ...patch });

  // Without a real action there is nothing to confirm or disable.
  const showConcede = typeof onConcede === "function";
  const concedeEnabled = showConcede && canConcede === true;

  const requestConcede = () => {
    if (!onConcede) return;
    const outcome = resolveConcedeRequest({
      hasConcedeAction: showConcede,
      canConcede: canConcede === true,
      confirmConcede: settings.confirmConcede
    });
    if (outcome === "ignore") return;
    if (outcome === "confirm") {
      setConfirmingConcede(true);
      return;
    }
    onConcede();
  };

  const confirmConcede = () => {
    if (!concedeEnabled || !onConcede) return;
    setConfirmingConcede(false);
    onConcede();
  };

  return (
    <div className="stg-controls" role="region" aria-label={MATCH_CONTROLS_LABEL}>
      <details className="stg-gear">
        <summary className="stg-gear-summary" aria-label={MATCH_GEAR_SUMMARY_LABEL}>
          <span className="stg-gear-icon" aria-hidden="true">
            ⚙
          </span>
          <span className="stg-gear-text">{MATCH_GEAR_SUMMARY_LABEL}</span>
        </summary>
        <div className="stg-gear-panel">
          <div className="stg-gear-row">
            <span className="stg-gear-row-label">卡牌尺寸</span>
            <div className="stg-segment stg-segment-compact" role="radiogroup" aria-label="卡牌尺寸">
              {CARD_SCALE_OPTIONS.map(option => (
                <label
                  key={option.value}
                  className="stg-segment-option"
                  data-active={settings.cardScale === option.value}
                >
                  <input
                    type="radio"
                    name="stg-match-card-scale"
                    value={option.value}
                    checked={settings.cardScale === option.value}
                    onChange={() => update({ cardScale: option.value })}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="stg-toggle stg-toggle-compact">
            <input
              type="checkbox"
              checked={settings.reducedMotion}
              onChange={event => update({ reducedMotion: event.currentTarget.checked })}
            />
            <span className="stg-toggle-label">减少动态效果</span>
          </label>
          <label className="stg-toggle stg-toggle-compact">
            <input
              type="checkbox"
              checked={settings.showCardNames}
              onChange={event => update({ showCardNames: event.currentTarget.checked })}
            />
            <span className="stg-toggle-label">显示卡牌名称</span>
          </label>
          <label className="stg-toggle stg-toggle-compact">
            <input
              type="checkbox"
              checked={settings.confirmConcede}
              onChange={event => update({ confirmConcede: event.currentTarget.checked })}
            />
            <span className="stg-toggle-label">认输需要二次确认</span>
          </label>
        </div>
      </details>

      <div className="stg-nav">
        <button type="button" className="stg-button" onClick={onGoHome}>
          {MATCH_GO_HOME_LABEL}
        </button>
        <button type="button" className="stg-button" onClick={onGoRoom}>
          {MATCH_GO_ROOM_LABEL}
        </button>
        {showConcede ? (
          confirmingConcede ? (
            <span className="stg-concede-confirm" role="group" aria-label="认输确认">
              <button
                type="button"
                className="stg-button stg-button-danger"
                disabled={!concedeEnabled}
                onClick={confirmConcede}
              >
                {MATCH_CONCEDE_CONFIRM_LABEL}
              </button>
              <button
                type="button"
                className="stg-button"
                onClick={() => setConfirmingConcede(false)}
              >
                {MATCH_CONCEDE_CANCEL_LABEL}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="stg-button stg-button-danger"
              disabled={!concedeEnabled}
              onClick={requestConcede}
            >
              {MATCH_CONCEDE_LABEL}
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
