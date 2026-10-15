import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  EMPTY_REGION_OPTIONS_NOTICE,
  EVENT_DATE_INVALID_REASON,
  EVENT_DATE_MISSING_REASON,
  EVENT_DATE_PLACEHOLDER,
  REGIONAL_ROOM_DISABLED_NOTICE,
  REGION_NOT_OFFERED_REASON,
  SELECTION_MISSING_REASON,
  RegionalRoomOptions,
  isRegionalEventDate,
  validateRegionalRoomSelection
} from "../../src/full-product/components/RegionalRoomOptions";
import type {
  RegionalRoomOption,
  RegionalRoomOptionsProps,
  RegionalRoomSelection
} from "../../src/full-product/components/RegionalRoomOptions";

const REGIONS: readonly RegionalRoomOption[] = [
  { regionCode: "CN", label: "中国大陆" },
  { regionCode: "TW", label: "中国台湾" },
  { regionCode: "FR", label: "法国" }
];

// SSR only here: `renderToStaticMarkup` produces a static string, so these
// assertions cover the rendered contract (labels, attributes, gating). They are
// NOT a real-DOM click or a native `<select>`/`<input>` interaction test.
function render(overrides: Partial<RegionalRoomOptionsProps> = {}): string {
  const props: RegionalRoomOptionsProps = {
    options: REGIONS,
    value: null,
    onChange: () => {},
    ...overrides
  };
  return renderToStaticMarkup(<RegionalRoomOptions {...props} />);
}

function tagFor(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `control ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<", index);
  const close = html.indexOf(">", index);
  return html.slice(open, close + 1);
}

describe("RegionalRoomOptions SSR contract", () => {
  it("renders every parent-provided option verbatim and no default region", () => {
    const html = render();
    for (const option of REGIONS) {
      expect(html).toContain(`value="${option.regionCode}"`);
      expect(html).toContain(option.label);
    }
    // No region is pre-selected: React SSR marks the empty placeholder option
    // as `selected` and leaves every real region option unselected.
    expect(html).toContain('<option value="" selected="">');
    expect(html).not.toContain('value="CN" selected');
    expect(html).not.toContain('value="TW" selected');
    // A localized label is only a label, never a region code.
    expect(html).not.toContain(`value="法国"`);
  });

  it("renders the caller's selection verbatim rather than a computed default", () => {
    const value: RegionalRoomSelection = { regionCode: "TW", eventDate: "2044-02-29" };
    const html = render({ value });
    expect(html).toContain(`value="TW"`);
    expect(html).toContain(`value="2044-02-29"`);
    expect(html).toContain(EVENT_DATE_PLACEHOLDER);
  });

  it("does not fabricate a UTC day: an empty date stays empty with a placeholder", () => {
    const html = render({ value: { regionCode: "CN", eventDate: "" } });
    expect(tagFor(html, "赛事当地日期（YYYY-MM-DD）")).toContain(`value=""`);
    expect(html).toContain(EVENT_DATE_PLACEHOLDER);
    // No "today" leaked in as a value attribute.
    const today = new Date().toISOString().slice(0, 10);
    expect(html).not.toContain(`value="${today}"`);
  });

  it("disables both controls and reports usage when disabled or optionless", () => {
    const disabled = render({ disabled: true });
    expect(tagFor(disabled, "赛事地区")).toContain("disabled");
    expect(tagFor(disabled, "赛事当地日期（YYYY-MM-DD）")).toContain("disabled");
    expect(disabled).toContain(REGIONAL_ROOM_DISABLED_NOTICE);

    const empty = render({ options: [] });
    expect(tagFor(empty, "赛事地区")).toContain("disabled");
    expect(tagFor(empty, "赛事当地日期（YYYY-MM-DD）")).toContain("disabled");
    expect(empty).toContain(EMPTY_REGION_OPTIONS_NOTICE);
  });

  it("does not call onChange during render (controlled, no self-mutation)", () => {
    const onChange = vi.fn();
    render({ onChange, value: null });
    render({ onChange, value: { regionCode: "CN", eventDate: "2026-10-18" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("isRegionalEventDate", () => {
  it("accepts real calendar dates and the correct leap day", () => {
    expect(isRegionalEventDate("2026-10-18")).toBe(true);
    expect(isRegionalEventDate("2024-02-29")).toBe(true);
    expect(isRegionalEventDate("2044-02-29")).toBe(true);
  });

  it("rejects malformed, impossible and non-string dates", () => {
    expect(isRegionalEventDate("2026-10-8")).toBe(false);
    expect(isRegionalEventDate("2026/10/18")).toBe(false);
    expect(isRegionalEventDate("2026-13-01")).toBe(false);
    expect(isRegionalEventDate("2026-00-10")).toBe(false);
    expect(isRegionalEventDate("2026-10-00")).toBe(false);
    expect(isRegionalEventDate("2042-02-30")).toBe(false);
    expect(isRegionalEventDate("2043-02-29")).toBe(false);
    expect(isRegionalEventDate("2100-02-29")).toBe(false);
    expect(isRegionalEventDate("")).toBe(false);
    expect(isRegionalEventDate("today")).toBe(false);
    expect(isRegionalEventDate(20261018)).toBe(false);
    expect(isRegionalEventDate(null)).toBe(false);
    expect(isRegionalEventDate(undefined)).toBe(false);
  });
});

describe("validateRegionalRoomSelection", () => {
  it("fails closed on a missing selection, empty region, or missing date", () => {
    const missing = validateRegionalRoomSelection(null, REGIONS);
    expect(missing).toEqual({ ok: false, reason: SELECTION_MISSING_REASON });
    expect(validateRegionalRoomSelection(undefined, REGIONS).ok).toBe(false);

    const noRegion = validateRegionalRoomSelection(
      { regionCode: "", eventDate: "2026-10-18" },
      REGIONS
    );
    expect(noRegion).toEqual({ ok: false, reason: SELECTION_MISSING_REASON });

    const noDate = validateRegionalRoomSelection(
      { regionCode: "CN", eventDate: "" },
      REGIONS
    );
    expect(noDate).toEqual({ ok: false, reason: EVENT_DATE_MISSING_REASON });
  });

  it("rejects an off-list region even when the date is valid", () => {
    const offList = validateRegionalRoomSelection(
      { regionCode: "ZZ", eventDate: "2026-10-18" },
      REGIONS
    );
    expect(offList).toEqual({ ok: false, reason: REGION_NOT_OFFERED_REASON });
    // An empty option list refuses every region.
    expect(
      validateRegionalRoomSelection({ regionCode: "CN", eventDate: "2026-10-18" }, []).ok
    ).toBe(false);
  });

  it("rejects invalid and impossible calendar dates", () => {
    expect(
      validateRegionalRoomSelection({ regionCode: "CN", eventDate: "2043-02-29" }, REGIONS)
    ).toEqual({ ok: false, reason: EVENT_DATE_INVALID_REASON });
    expect(
      validateRegionalRoomSelection({ regionCode: "CN", eventDate: "2026-10-8" }, REGIONS)
    ).toEqual({ ok: false, reason: EVENT_DATE_INVALID_REASON });
  });

  it("returns the normalized selection only for an offered region + real date", () => {
    const ok = validateRegionalRoomSelection(
      { regionCode: "CN", eventDate: "2044-02-29" },
      REGIONS
    );
    expect(ok).toEqual({ ok: true, value: { regionCode: "CN", eventDate: "2044-02-29" } });
  });
});
