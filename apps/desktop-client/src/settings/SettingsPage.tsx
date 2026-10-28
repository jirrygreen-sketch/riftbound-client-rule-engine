import "./SettingsPage.css";
import { CARD_SCALE_OPTIONS, type DisplaySettings } from "./display-settings";
import type { LocalCardImagesState } from "../hooks/useLocalCardImages";

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
  /** Desktop-only local card-art cache (RIFT-1129); hidden in the browser. */
  readonly localCardImages?: LocalCardImagesState;
}

export function SettingsPage({ settings, onChange, saveError = null, localCardImages }: SettingsPageProps) {
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

        {localCardImages?.supported ? <LocalCardImagesCard state={localCardImages} /> : null}
      </div>
    </section>
  );
}

function LocalCardImagesCard({ state }: { readonly state: LocalCardImagesState }) {
  const { progress, error } = state;
  const running = progress?.running ?? false;
  const complete = progress !== null && progress.total > 0 && progress.cached >= progress.total;
  const summary = progress === null
    ? "等待卡牌目录加载后开始下载。"
    : `已下载 ${progress.cached} / ${progress.total} 张${progress.failed > 0 ? `，失败 ${progress.failed} 张` : ""}`;
  const status = complete
    ? "全部卡图已保存在本机，之后直接读取本地文件。"
    : running
      ? "正在后台下载官方原图……"
      : progress?.cancelled
        ? "已暂停。"
        : progress !== null && progress.failed > 0
          ? "部分卡图下载失败，可点击“继续下载”重试。"
          : null;

  return (
    <fieldset className="stg-card" aria-label="本地卡图">
      <legend className="stg-card-title">本地卡图</legend>
      <p className="stg-hint">把官方卡图原图下载到本机；已下载的卡图不再从网络读取，未下载的先临时在线显示。</p>
      <p className="stg-local-images-summary" role="status">{summary}</p>
      {progress !== null && progress.total > 0 ? (
        <progress className="stg-local-images-progress" max={progress.total} value={progress.cached}
          aria-label="本地卡图下载进度" />
      ) : null}
      {status ? <p className="stg-hint">{status}</p> : null}
      {error ? <p className="stg-save-error" role="alert">{error}</p> : null}
      {complete ? null : running ? (
        <button type="button" className="stg-button" onClick={state.pause}>暂停下载</button>
      ) : (
        <button type="button" className="stg-button" onClick={state.resume}>继续下载</button>
      )}
    </fieldset>
  );
}
