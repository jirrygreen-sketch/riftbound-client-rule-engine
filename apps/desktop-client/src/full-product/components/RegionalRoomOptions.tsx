/**
 * Regional room options: an explicit event region plus the event-local
 * calendar date.
 *
 * Boundary contract (read before wiring this into the room-create flow):
 * - This is PRESENTATION plus pure validation. It is a controlled view over
 *   user selection state (`value` / `onChange`). It is NOT authoritative room
 *   or server state, it never creates a room, never talks to a transport, and
 *   never decides product availability. The parent task owns the real
 *   `App` -> room-create adapter.
 * - There is intentionally NO default region. The component never guesses a
 *   region from the browser language, `navigator.language`, `Intl`, the host
 *   timezone, or a locale list. The only region codes that exist are the ones
 *   handed in via `options`; a French or otherwise localized label is a label,
 *   never a region.
 * - There is intentionally NO default date. Before the user types a date the
 *   `eventDate` stays the empty string, and `validateRegionalRoomSelection`
 *   fails closed on it. The component never derives "today" from the current
 *   clock or from a UTC instant, so no UTC day is fabricated before the user
 *   picks the event-local date.
 * - `eventDate` is the calendar date at the event's location in strict
 *   `YYYY-MM-DD` form, validated as a real calendar date (month length plus
 *   leap years). `2043-02-29` and `2042-02-30` are rejected, `2044-02-29` is
 *   accepted.
 * - `validateRegionalRoomSelection` is exported as the pure, reusable guard so
 *   a submit path can refuse an incomplete or off-list selection. It grants no
 *   authority: it only re-checks the caller's own options and value.
 */

export interface RegionalRoomOption {
  /** Opaque region code supplied by the parent. Never inferred or hardcoded. */
  readonly regionCode: string;
  /** Human-facing label supplied by the parent (may be localized). */
  readonly label: string;
}

export interface RegionalRoomSelection {
  /** "" means "no region chosen yet". */
  readonly regionCode: string;
  /**
   * Event-location calendar date, strict `YYYY-MM-DD`. "" means "no date
   * chosen yet" and is always invalid at submit time; it is never replaced by
   * a fabricated day.
   */
  readonly eventDate: string;
}

export interface RegionalRoomOptionsProps {
  /** Parent-provided region list. Rendered verbatim; may be any array. */
  readonly options: readonly RegionalRoomOption[];
  /** Controlled user selection; `null` means "nothing chosen yet". */
  readonly value: RegionalRoomSelection | null;
  /** Reports the user's next selection; never called while `disabled`. */
  readonly onChange: (value: RegionalRoomSelection) => void;
  /** Read-only mode. When true the controls are disabled and cannot emit. */
  readonly disabled?: boolean;
}

export const REGIONAL_ROOM_OPTIONS_LABEL = "地区赛事房间设置";
export const REGION_FIELD_LABEL = "赛事地区";
export const REGION_PLACEHOLDER_LABEL = "请选择赛事地区";
export const EVENT_DATE_FIELD_LABEL = "赛事当地日期";
export const EVENT_DATE_INPUT_LABEL = "赛事当地日期（YYYY-MM-DD）";
export const EVENT_DATE_PLACEHOLDER = "YYYY-MM-DD";
export const EVENT_DATE_HINT =
  "选择赛事举办地区，并填写当地日期；卡牌是否可用会按该地区的官方发售日判断。";
export const EMPTY_REGION_OPTIONS_NOTICE = "暂无可选赛事地区，无法创建地区赛事房间。";
export const REGIONAL_ROOM_DISABLED_NOTICE = "当前不可编辑赛事地区与日期。";

export const SELECTION_MISSING_REASON = "请先选择赛事地区。";
export const EVENT_DATE_MISSING_REASON = "请填写赛事当地日期（YYYY-MM-DD）。";
export const EVENT_DATE_INVALID_REASON =
  "日期无效，请使用 YYYY-MM-DD 并确认是真实存在的日期。";
export const REGION_NOT_OFFERED_REASON = "所选赛事地区不在当前可选范围内。";

export type RegionalRoomSelectionCheck =
  | { readonly ok: true; readonly value: RegionalRoomSelection }
  | { readonly ok: false; readonly reason: string };

const EVENT_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/**
 * Strict real-calendar check for `YYYY-MM-DD`. No `Date` parsing and no
 * best-effort coercion, so it cannot silently accept a rolled-over day.
 */
export function isRegionalEventDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = EVENT_DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/**
 * Pure submit guard. Fails closed until an offered region AND a real
 * event-local calendar date are both present. `options` is the caller's own
 * list, so an off-list region code is refused rather than trusted.
 */
export function validateRegionalRoomSelection(
  selection: RegionalRoomSelection | null | undefined,
  options: readonly RegionalRoomOption[]
): RegionalRoomSelectionCheck {
  if (selection === null || selection === undefined) {
    return { ok: false, reason: SELECTION_MISSING_REASON };
  }
  const regionCode =
    typeof selection.regionCode === "string" ? selection.regionCode : "";
  const eventDate =
    typeof selection.eventDate === "string" ? selection.eventDate : "";
  if (regionCode.length === 0) {
    return { ok: false, reason: SELECTION_MISSING_REASON };
  }
  const offered = options.some(
    option => option.regionCode === regionCode
  );
  if (!offered) {
    return { ok: false, reason: REGION_NOT_OFFERED_REASON };
  }
  if (eventDate.length === 0) {
    return { ok: false, reason: EVENT_DATE_MISSING_REASON };
  }
  if (!isRegionalEventDate(eventDate)) {
    return { ok: false, reason: EVENT_DATE_INVALID_REASON };
  }
  return { ok: true, value: { regionCode, eventDate } };
}

/**
 * Controlled region + date picker. Renders the caller's selection verbatim and
 * only forwards the user's own next selection through `onChange`.
 */
export function RegionalRoomOptions({
  options,
  value,
  onChange,
  disabled = false
}: RegionalRoomOptionsProps) {
  const regionCode = value?.regionCode ?? "";
  const eventDate = value?.eventDate ?? "";
  const hasOptions = options.length > 0;
  const controlsDisabled = disabled || !hasOptions;
  const check = value === null ? null : validateRegionalRoomSelection(value, options);

  return (
    <section
      className="full-product-regional-room-options"
      aria-label={REGIONAL_ROOM_OPTIONS_LABEL}
    >
      <h3 className="full-product-regional-room-options-title">地区赛事</h3>

      <label className="full-product-regional-room-options-field">
        <span className="full-product-regional-room-options-label">
          {REGION_FIELD_LABEL}
        </span>
        <select
          className="full-product-regional-room-options-region"
          aria-label={REGION_FIELD_LABEL}
          value={regionCode}
          disabled={controlsDisabled}
          onChange={event =>
            onChange({ regionCode: event.currentTarget.value, eventDate })
          }
        >
          <option value="">{REGION_PLACEHOLDER_LABEL}</option>
          {options.map(option => (
            <option key={option.regionCode} value={option.regionCode}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="full-product-regional-room-options-field">
        <span className="full-product-regional-room-options-label">
          {EVENT_DATE_FIELD_LABEL}
        </span>
        <input
          className="full-product-regional-room-options-date"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          aria-label={EVENT_DATE_INPUT_LABEL}
          placeholder={EVENT_DATE_PLACEHOLDER}
          value={eventDate}
          disabled={controlsDisabled}
          onChange={event =>
            onChange({ regionCode, eventDate: event.currentTarget.value })
          }
        />
      </label>

      <p className="full-product-regional-room-options-hint">{EVENT_DATE_HINT}</p>

      {!hasOptions ? (
        <p className="full-product-regional-room-options-notice">
          {EMPTY_REGION_OPTIONS_NOTICE}
        </p>
      ) : null}

      {disabled && hasOptions ? (
        <p className="full-product-regional-room-options-notice">
          {REGIONAL_ROOM_DISABLED_NOTICE}
        </p>
      ) : null}

      {check !== null && !check.ok ? (
        <p
          className="full-product-regional-room-options-pending"
          role="status"
        >
          {check.reason}
        </p>
      ) : null}
    </section>
  );
}
