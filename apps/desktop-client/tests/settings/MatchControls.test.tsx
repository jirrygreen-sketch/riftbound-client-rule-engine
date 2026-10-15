import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DEFAULT_DISPLAY_SETTINGS,
  type DisplaySettings
} from "../../src/settings/display-settings";
import {
  MATCH_CONCEDE_CANCEL_LABEL,
  MATCH_CONCEDE_CONFIRM_LABEL,
  MATCH_CONCEDE_LABEL,
  MATCH_CONTROLS_LABEL,
  MATCH_GEAR_SUMMARY_LABEL,
  MATCH_GO_HOME_LABEL,
  MATCH_GO_ROOM_LABEL,
  MatchControls,
  resolveConcedeRequest,
  type MatchControlsProps
} from "../../src/settings/MatchControls";
import { SettingsPage } from "../../src/settings/SettingsPage";

// SSR cannot click. Force the concede `useState` initial value to `true` for the
// confirmation-view test so the real two-step branch renders; every other state
// keeps its real initial value.
const forceConcedeConfirm = vi.hoisted(() => ({ value: false }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: ((initial: unknown) =>
      actual.useState(
        initial === false && forceConcedeConfirm.value ? true : initial
      )) as typeof actual.useState
  };
});

const render = (props: MatchControlsProps): string =>
  renderToStaticMarkup(<MatchControls {...props} />);

const baseProps: MatchControlsProps = {
  settings: DEFAULT_DISPLAY_SETTINGS,
  onChange: () => undefined,
  onGoHome: () => undefined,
  onGoRoom: () => undefined
};

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

/** React's SSR output orders attributes as `checked="" value="..."`. */
const checkedRadios = (html: string): number => count(html, 'checked="" value=');

describe("MatchControls markup", () => {
  it("renders the gear panel, match navigation, and no fabricated concede action", () => {
    const html = render(baseProps);

    expect(html).toContain(`aria-label="${MATCH_CONTROLS_LABEL}"`);
    expect(html).toContain("<details");
    expect(html).toContain(`aria-label="${MATCH_GEAR_SUMMARY_LABEL}"`);
    expect(html).toContain(MATCH_GO_HOME_LABEL);
    expect(html).toContain(MATCH_GO_ROOM_LABEL);
    // No onConcede handler -> no concede button at all. (The gear's
    // "认输需要二次确认" label legitimately contains the substring, so assert on
    // the danger button class instead.)
    expect(html).not.toContain("stg-button-danger");
    expect(html).not.toContain(`>${MATCH_CONCEDE_LABEL}</button>`);
  });

  it("shows all four local display controls inside the expandable gear", () => {
    const html = render(baseProps);
    expect(html).toContain("卡牌尺寸");
    expect(html).toContain("减少动态效果");
    expect(html).toContain("显示卡牌名称");
    expect(html).toContain("认输需要二次确认");
    // Card scale is a real radiogroup with the three native radio values.
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('value="small"');
    expect(html).toContain('value="medium"');
    expect(checkedRadios(html)).toBe(1);
    expect(html).toContain('value="large"');
  });

  it("reflects the provided settings in the gear inputs", () => {
    const settings: DisplaySettings = {
      cardScale: "large",
      reducedMotion: true,
      showCardNames: false,
      confirmConcede: false
    };
    const html = render({ ...baseProps, settings });
    // exactly one checked radio, and it is the large one. React emits
    // `checked="" value="large"`, so match on the checked radio plus its value.
    expect(checkedRadios(html)).toBe(1);
    expect(html).toContain('checked="" value="large"');
    expect(count(html, 'type="checkbox" checked=""')).toBe(1);
    expect(html).toContain('data-active="true"');
  });

  it("shows an enabled concede button when a handler is provided and allowed", () => {
    const html = render({ ...baseProps, onConcede: () => undefined, canConcede: true });
    expect(html).toContain(MATCH_CONCEDE_LABEL);
    expect(html).toContain("stg-button-danger");
    expect(html).not.toContain("disabled");
  });

  it("renders the concede button disabled when canConcede is false or omitted", () => {
    const omitted = render({ ...baseProps, onConcede: () => undefined });
    expect(omitted).toContain(MATCH_CONCEDE_LABEL);
    expect(omitted).toContain("disabled");

    const blocked = render({ ...baseProps, onConcede: () => undefined, canConcede: false });
    expect(blocked).toContain(MATCH_CONCEDE_LABEL);
    expect(blocked).toContain("disabled");
  });

  it("renders the two-step confirmation buttons when confirmation is open", () => {
    forceConcedeConfirm.value = true;
    try {
      const html = render({ ...baseProps, onConcede: () => undefined, canConcede: true });
      expect(html).toContain(MATCH_CONCEDE_CONFIRM_LABEL);
      expect(html).toContain(MATCH_CONCEDE_CANCEL_LABEL);
      expect(html).toContain('aria-label="认输确认"');
    } finally {
      forceConcedeConfirm.value = false;
    }
  });
});

describe("resolveConcedeRequest", () => {
  it("ignores the request when no concede action or not allowed", () => {
    expect(
      resolveConcedeRequest({ hasConcedeAction: false, canConcede: true, confirmConcede: true })
    ).toBe("ignore");
    expect(
      resolveConcedeRequest({ hasConcedeAction: true, canConcede: false, confirmConcede: false })
    ).toBe("ignore");
  });

  it("asks for confirmation only when the confirm option is enabled", () => {
    expect(
      resolveConcedeRequest({ hasConcedeAction: true, canConcede: true, confirmConcede: true })
    ).toBe("confirm");
  });

  it("submits directly when confirmation is disabled", () => {
    expect(
      resolveConcedeRequest({ hasConcedeAction: true, canConcede: true, confirmConcede: false })
    ).toBe("concede");
  });
});

describe("SettingsPage markup", () => {
  it("renders each card-scale and toggle control with the current values", () => {
    const settings: DisplaySettings = {
      cardScale: "small",
      reducedMotion: false,
      showCardNames: true,
      confirmConcede: false
    };
    const html = renderToStaticMarkup(
      <SettingsPage settings={settings} onChange={() => undefined} />
    );

    expect(html).toContain('role="region"');
    expect(html).toContain("显示设置");
    expect(html).toContain('checked="" value="small"');
    expect(checkedRadios(html)).toBe(1);
    expect(html).toContain("认输需要二次确认");
    // No save error provided -> no alert region.
    expect(html).not.toContain('role="alert"');
  });

  it("surfaces a parent save error and never hides the inputs", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        settings={DEFAULT_DISPLAY_SETTINGS}
        onChange={() => undefined}
        saveError="设置保存失败，请检查浏览器存储权限。"
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("设置保存失败，请检查浏览器存储权限。");
    expect(html).toContain('checked="" value="medium"');
    expect(checkedRadios(html)).toBe(1);
  });
});
