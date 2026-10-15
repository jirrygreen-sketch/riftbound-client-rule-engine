import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_CARD_POPOVER_CLASS,
  DUEL_CARD_POPOVER_CLOSE_LABEL,
  DUEL_CARD_POPOVER_GAP,
  DUEL_CARD_POPOVER_INSPECT_TEXT,
  DUEL_CARD_POPOVER_MARGIN,
  DUEL_CARD_POPOVER_PREFERRED_MAX_HEIGHT,
  DUEL_CARD_POPOVER_PREFERRED_WIDTH,
  DuelCardActionPopover,
  computeDuelCardPopoverLayout
} from "../../src/full-product/interactions/DuelCardActionPopover";

/**
 * `DuelCardActionPopover` is a presentation seam: it owns *where* the box goes
 * and *how* it is dismissed, never *which* actions exist. It reads no
 * projection and builds no command — the caller passes the real action/selection
 * form as `children`.
 *
 * Two boundaries are covered here without pulling in a DOM library:
 *  - `computeDuelCardPopoverLayout` is a pure function, so placement, flipping
 *    and clamping are asserted directly against real viewport/anchor rects.
 *  - The SSR path (no `window`/`document`) must render the *same* inline,
 *    un-positioned markup instead of throwing on `createPortal`.
 * The live focus/scroll/dismissal wiring and native rendering stay a native
 * acceptance boundary; the CSS scoping guard below only checks the file text.
 */

const POPOVER_CSS_PATH = fileURLToPath(
  new URL("../../src/full-product/interactions/DuelCardActionPopover.css", import.meta.url)
);
const WIDE = { width: 1024, height: 720 };

describe("computeDuelCardPopoverLayout", () => {
  it("prefers the card's right side when it fits", () => {
    const layout = computeDuelCardPopoverLayout({
      anchor: { left: 400, top: 200, width: 120, height: 170 },
      viewport: WIDE
    });
    expect(layout.side).toBe("right");
    expect(layout.flipped).toBe(false);
    expect(layout.width).toBe(DUEL_CARD_POPOVER_PREFERRED_WIDTH);
    expect(layout.left).toBe(400 + 120 + DUEL_CARD_POPOVER_GAP);
    expect(layout.top).toBe(200);
  });

  it("flips to the left side when the right would overflow the viewport", () => {
    const layout = computeDuelCardPopoverLayout({
      anchor: { left: 900, top: 200, width: 110, height: 170 },
      viewport: WIDE
    });
    expect(layout.side).toBe("left");
    expect(layout.flipped).toBe(true);
    expect(layout.width).toBe(DUEL_CARD_POPOVER_PREFERRED_WIDTH);
    expect(layout.left).toBe(900 - DUEL_CARD_POPOVER_GAP - DUEL_CARD_POPOVER_PREFERRED_WIDTH);
  });

  it("never overflows 1024x720 on any edge for a mid-board card", () => {
    const layout = computeDuelCardPopoverLayout({
      anchor: { left: 128, top: 96, width: 160, height: 224 },
      viewport: WIDE
    });
    expect(layout.left).toBeGreaterThanOrEqual(DUEL_CARD_POPOVER_MARGIN);
    expect(layout.left + layout.width).toBeLessThanOrEqual(
      WIDE.width - DUEL_CARD_POPOVER_MARGIN
    );
    expect(layout.top).toBeGreaterThanOrEqual(DUEL_CARD_POPOVER_MARGIN);
    expect(layout.top + layout.maxHeight).toBeLessThanOrEqual(
      WIDE.height - DUEL_CARD_POPOVER_MARGIN
    );
  });

  it("clamps back inside the viewport when neither side has room", () => {
    const layout = computeDuelCardPopoverLayout({
      anchor: { left: 250, top: 100, width: 120, height: 170 },
      viewport: { width: 400, height: 720 }
    });
    // Left has more room than a 22px right strip, so it flips and then clamps.
    expect(layout.side).toBe("left");
    expect(layout.left).toBe(DUEL_CARD_POPOVER_MARGIN);
    expect(layout.left + layout.width).toBeLessThanOrEqual(
      400 - DUEL_CARD_POPOVER_MARGIN
    );
  });

  it("keeps the top edge inside the viewport for a card near the bottom", () => {
    const layout = computeDuelCardPopoverLayout({
      anchor: { left: 120, top: 690, width: 120, height: 170 },
      viewport: WIDE
    });
    expect(layout.top).toBeGreaterThanOrEqual(DUEL_CARD_POPOVER_MARGIN);
    expect(layout.top + layout.maxHeight).toBeLessThanOrEqual(
      WIDE.height - DUEL_CARD_POPOVER_MARGIN
    );
  });

  it("shrinks to the viewport and stays scrollable in a small window", () => {
    const layout = computeDuelCardPopoverLayout({
      anchor: { left: 10, top: 10, width: 60, height: 90 },
      viewport: { width: 300, height: 240 }
    });
    // width/height cap at "viewport - 2 * margin" (viewport - 16 at margin 8).
    expect(layout.width).toBe(300 - DUEL_CARD_POPOVER_MARGIN * 2);
    expect(layout.maxHeight).toBe(240 - DUEL_CARD_POPOVER_MARGIN * 2);
    expect(layout.left).toBeGreaterThanOrEqual(DUEL_CARD_POPOVER_MARGIN);
    expect(layout.left + layout.width).toBeLessThanOrEqual(
      300 - DUEL_CARD_POPOVER_MARGIN
    );
    expect(layout.top + layout.maxHeight).toBeLessThanOrEqual(
      240 - DUEL_CARD_POPOVER_MARGIN
    );
  });

  it("caps the preferred size on a large viewport", () => {
    const layout = computeDuelCardPopoverLayout({
      anchor: { left: 10, top: 10, width: 100, height: 140 },
      viewport: { width: 2560, height: 1440 }
    });
    expect(layout.width).toBe(DUEL_CARD_POPOVER_PREFERRED_WIDTH);
    expect(layout.maxHeight).toBe(DUEL_CARD_POPOVER_PREFERRED_MAX_HEIGHT);
  });

  it("places a short menu beside a bottom hand card using its rendered height", () => {
    const layout = computeDuelCardPopoverLayout({
      anchor: { left: 120, top: 650, width: 80, height: 110 },
      viewport: WIDE,
      measuredHeight: 120
    });
    expect(layout.top).toBe(592);
    expect(layout.top + 120).toBe(WIDE.height - DUEL_CARD_POPOVER_MARGIN);
    expect(layout.maxHeight).toBe(DUEL_CARD_POPOVER_PREFERRED_MAX_HEIGHT);
  });

  it("degrades to a zero-size box instead of returning negatives", () => {
    const layout = computeDuelCardPopoverLayout({
      anchor: { left: 0, top: 0, width: 0, height: 0 },
      viewport: { width: 0, height: 0 }
    });
    expect(layout.width).toBe(0);
    expect(layout.maxHeight).toBe(0);
    expect(layout.left).toBe(0);
    expect(layout.top).toBe(0);
  });
});

describe("DuelCardActionPopover SSR boundary", () => {
  it("renders inline markup instead of throwing on createPortal during SSR", () => {
    const html = renderToStaticMarkup(
      <DuelCardActionPopover
        anchor={{ left: 100, top: 100, width: 120, height: 170 }}
        title="星辰低语"
        onClose={() => {}}
      >
        <button type="button">打出</button>
      </DuelCardActionPopover>
    );
    expect(html).toContain(`class="${DUEL_CARD_POPOVER_CLASS}"`);
    expect(html).toContain("星辰低语");
    expect(html).toContain("打出");
  });

  it("renders un-positioned and hidden until it is measured client-side", () => {
    const html = renderToStaticMarkup(
      <DuelCardActionPopover
        anchor={{ left: 100, top: 100, width: 120, height: 170 }}
        title="星辰低语"
        onClose={() => {}}
      >
        <button type="button">打出</button>
      </DuelCardActionPopover>
    );
    expect(html).toContain('data-positioned="false"');
    expect(html).toContain("visibility:hidden");
    // No left/top is emitted before measurement, so the box cannot flash misplaced.
    expect(html).not.toContain("left:100px");
  });

  it("is a non-modal dialog with the card title and a close control", () => {
    const html = renderToStaticMarkup(
      <DuelCardActionPopover
        anchor={{ left: 0, top: 0, width: 100, height: 140 }}
        title="星辰低语"
        onClose={() => {}}
      >
        <button type="button">打出</button>
      </DuelCardActionPopover>
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="false"');
    expect(html).toContain(`aria-label="${DUEL_CARD_POPOVER_CLOSE_LABEL}"`);
    expect(html).toContain(`${DUEL_CARD_POPOVER_CLASS}-body`);
  });

  it("omits the inspect footer unless onInspect is provided", () => {
    const props = {
      anchor: { left: 0, top: 0, width: 100, height: 140 },
      title: "星辰低语",
      onClose: () => {}
    };
    const withInspect = renderToStaticMarkup(
      <DuelCardActionPopover {...props} onInspect={() => {}}>
        <button type="button">打出</button>
      </DuelCardActionPopover>
    );
    expect(withInspect).toContain(DUEL_CARD_POPOVER_INSPECT_TEXT);

    const withoutInspect = renderToStaticMarkup(
      <DuelCardActionPopover {...props}>
        <button type="button">打出</button>
      </DuelCardActionPopover>
    );
    expect(withoutInspect).not.toContain(DUEL_CARD_POPOVER_INSPECT_TEXT);
    expect(withoutInspect).not.toContain(`${DUEL_CARD_POPOVER_CLASS}-foot`);
  });

  it("renders an arbitrary server-driven form passed as children", () => {
    const onSubmit = vi.fn();
    const html = renderToStaticMarkup(
      <DuelCardActionPopover
        anchor={{ left: 0, top: 0, width: 100, height: 140 }}
        title="星辰低语"
        onClose={() => {}}
      >
        <form onSubmit={onSubmit}>
          <label htmlFor="target-choice">选择目标</label>
          <select id="target-choice" name="target">
            <option value="u1">单位一</option>
          </select>
          <button type="submit">确认</button>
        </form>
      </DuelCardActionPopover>
    );
    expect(html).toContain("选择目标");
    expect(html).toContain('name="target"');
    expect(html).toContain("确认");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("DuelCardActionPopoverCSS scoping guard", () => {
  const css = readFileSync(POPOVER_CSS_PATH, "utf8");

  it("prefixes every rule with the popover scope class", () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((block) => block.split("{")[0]?.trim() ?? "")
      .filter((selector) => selector.length > 0 && !selector.startsWith("--"))
      .flatMap((selector) => selector.split(",").map((part) => part.trim()))
      .filter((selector) => selector.length > 0);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector.startsWith(`.${DUEL_CARD_POPOVER_CLASS}`)).toBe(true);
    }
  });

  it("floats the box with fixed positioning and a scrollable body", () => {
    expect(css).toContain("position: fixed");
    expect(css).toContain(`.${DUEL_CARD_POPOVER_CLASS}-body`);
    expect(css).toMatch(/overflow-y:\s*auto/);
  });

  it("does not style global elements", () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/(^|[},{])\s*(html|body|\*|:root)\b/);
  });
});
