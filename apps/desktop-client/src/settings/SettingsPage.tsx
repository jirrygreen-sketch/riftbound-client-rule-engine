import "./SettingsPage.css";
import { CARD_SCALE_OPTIONS, type DisplaySettings } from "./display-settings";

/**
 * Display-settings page.
 *
 * Purely presentational: it renders the current local `DisplaySettings` and
 * reports every intended change through `onChange`. It owns no game state and
 * never talks to the server; persistence and the mapping onto root data
 * attributes are owned by the parent. When a write fails, the parent passes
 * `saveError` and this page shows it — the inputs keep reflecting `settings`.
 */

export interface SettingsPageProps {
  readonly settings: DisplaySettings;
  readonly onChange: (next: DisplaySettings) => void;
  readonly saveError?: string | null;
}

export function SettingsPage({ settings, onChange, saveError = null }: SettingsPageProps) {
  const update = (patch: Partial<DisplaySettings>) => onChange({ ...settings, ...patch });

  return (
    <section className="stg-page" role="region" aria-label="显示设置">
      <header className="stg-head">
        <h2 className="stg-title">显示设置</h2>
        <p className="stg-subtitle">仅影响本机显示，不改变对局状态。</p>
      </header>

      {saveError ? (
        <p className="stg-save-error" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="stg-grid">
        <fieldset className="stg-card">
          <legend className="stg-card-title">卡牌尺寸</legend>
          <div className="stg-segment" role="radiogroup" aria-label="卡牌尺寸">
            {CARD_SCALE_OPTIONS.map(option => (
              <label
                key={option.value}
                className="stg-segment-option"
                data-active={settings.cardScale === option.value}
              >
                <input
                  type="radio"
                  name="stg-card-scale"
                  value={option.value}
                  checked={settings.cardScale === option.value}
                  onChange={() => update({ cardScale: option.value })}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <p className="stg-hint">调整牌桌手牌、基地与战场上卡牌的显示宽度。</p>
        </fieldset>

        <fieldset className="stg-card">
          <legend className="stg-card-title">动画与文字</legend>
          <label className="stg-toggle">
            <input
              type="checkbox"
              checked={settings.reducedMotion}
              onChange={event => update({ reducedMotion: event.currentTarget.checked })}
            />
            <span className="stg-toggle-text">
              <span className="stg-toggle-label">减少动态效果</span>
              <span className="stg-hint">关闭非必要的过渡与动画。</span>
            </span>
          </label>
          <label className="stg-toggle">
            <input
              type="checkbox"
              checked={settings.showCardNames}
              onChange={event => update({ showCardNames: event.currentTarget.checked })}
            />
            <span className="stg-toggle-text">
              <span className="stg-toggle-label">显示卡牌名称</span>
              <span className="stg-hint">在牌桌卡牌上叠加名称文字。</span>
            </span>
          </label>
        </fieldset>

        <fieldset className="stg-card">
          <legend className="stg-card-title">对局操作</legend>
          <label className="stg-toggle">
            <input
              type="checkbox"
              checked={settings.confirmConcede}
              onChange={event => update({ confirmConcede: event.currentTarget.checked })}
            />
            <span className="stg-toggle-text">
              <span className="stg-toggle-label">认输需要二次确认</span>
              <span className="stg-hint">提交认输前要求再次确认，避免误触。</span>
            </span>
          </label>
        </fieldset>
      </div>
    </section>
  );
}
