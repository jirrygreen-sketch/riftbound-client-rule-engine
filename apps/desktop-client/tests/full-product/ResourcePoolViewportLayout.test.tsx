import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  COMPACT_DETAILS_LABEL,
  PAYMENT_DISPLAY_ONLY_NOTE,
  ResourcePoolPanel
} from "../../src/full-product/components/ResourcePoolPanel";
import type {
  ResourcePoolPanelProps,
  ResourcePowerView
} from "../../src/full-product/components/ResourcePoolPanel";

/**
 * Viewport-layout coverage for the dense Duel resource row.
 *
 * The fix being covered is purely presentational: at a wide desktop screen the
 * resource pool has its own table row but renders as a bounded small block,
 * while the default compact view is a short summary row and detailed source
 * controls remain available on demand.
 *
 * These assertions read the real component CSS (a static mirror of the rules,
 * not a screenshot) and render the real `ResourcePoolPanel` so the invariants
 * that must NOT change are pinned too: the fail-closed gate, the supplied-only
 * action ids and the single authoritative payment preview. No count, gate or
 * command authority is asserted away.
 */

const readCss = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const layoutCss = readCss("../../src/full-product/components/DuelTableLayout.css");
const poolCss = readCss("../../src/full-product/components/ResourcePoolPanel.css");

/** All declaration bodies for `<selector> { ... }` (a selector may repeat). */
function blocks(css: string, selector: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(`${selector} {`, from);
    if (start < 0) break;
    const open = css.indexOf("{", start);
    const close = css.indexOf("}", open);
    bodies.push(css.slice(open + 1, close));
    from = close + 1;
  }
  expect(bodies.length, `selector ${selector} not found`).toBeGreaterThan(0);
  return bodies;
}

/** The block for `selector` that declares `needle` (e.g. "max-height"). */
function block(css: string, selector: string, needle?: string): string {
  const bodies = blocks(css, selector);
  if (needle === undefined) return bodies[0]!;
  const match = bodies.find(body => body.includes(needle));
  expect(match, `${selector} block with ${needle} not found`).toBeDefined();
  return match!;
}

const render = (props: ResourcePoolPanelProps): string =>
  renderToStaticMarkup(<ResourcePoolPanel {...props} />);

function buttonTag(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `button ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<button", index);
  const close = html.indexOf(">", index);
  return html.slice(open, close + 1);
}

const POWERS: readonly ResourcePowerView[] = [
  { id: "Fury", label: "炽烈", amount: 1 },
  { id: "Calm", label: "翠意", amount: 1 },
  { id: "Mind", label: "灵思", amount: 1 },
  { id: "Body", label: "坚毅", amount: 1 },
  { id: "Chaos", label: "混乱", amount: 1 },
  { id: "Order", label: "秩序", amount: 1 },
  { id: "any", label: "通用", amount: 1 }
];

/** The eight supplied sources the server projector emits for a banked Main. */
const SOURCE_ACTIONS = [
  { id: "rune-energy", label: "横置符文 +1 能量", enabled: true },
  { id: "recycle-Fury", label: "回收符文 +1 炽烈焰能", enabled: true },
  { id: "recycle-Calm", label: "回收符文 +1 翠意符能", enabled: true },
  { id: "recycle-Mind", label: "回收符文 +1 灵思符能", enabled: true },
  { id: "recycle-Body", label: "回收符文 +1 坚毅符能", enabled: true },
  { id: "recycle-Chaos", label: "回收符文 +1 混乱符能", enabled: true },
  { id: "recycle-Order", label: "回收符文 +1 秩序符能", enabled: true },
  { id: "gold", label: "横置并消灭金币 +1 任意符能", detail: "通用符能", enabled: true }
] as const;

const COUNTER_ACTIONS = [
  { id: "adjust-energy", label: "调整能量", enabled: true }
] as const;

const baseProps: ResourcePoolPanelProps = {
  energy: { amount: 4 },
  powers: POWERS,
  sourceActions: SOURCE_ACTIONS,
  counterActions: COUNTER_ACTIONS,
  status: "connected",
  commandPending: false,
  ended: false,
  onAction: vi.fn(),
  paymentSummary: {
    label: "本次支付",
    energyCost: 2,
    powerCosts: [{ label: "炽烈", amount: 1 }]
  },
  compact: true
};

describe("Duel table resource row layout (CSS reflects implementation)", () => {
  it("keeps bases and battlefields full-width, with separate hand and resource cells", () => {
    const main = block(layoutCss, ".full-product-duel-table-main");
    expect(main).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(main).toContain("clamp(200px, 27%, 280px)");
    expect(main).toContain('"hand resources"');
    expect(main).not.toContain('"player resources"');
    const order = ['"opponent opponent"', '"central central"', '"player player"', '"hand resources"'].map(marker =>
      main.indexOf(marker)
    );
    expect(order.every(index => index >= 0)).toBe(true);
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index]).toBeGreaterThan(order[index - 1]!);
    }
  });

  it("renders the resource row as one bounded small block", () => {
    const resources = block(layoutCss, ".full-product-duel-table-resources", "max-height");
    expect(resources).toContain("max-height: 100%");
    expect(resources).toContain("justify-self: stretch");
    expect(resources).toContain("width: 100%");
    expect(resources).toContain("background: transparent");
    expect(resources).toContain("overflow: auto");
    // The whole table body scrolls as a fallback rather than clipping a zone.
    expect(block(layoutCss, ".full-product-duel-table-main")).toContain("overflow: auto");
    expect(block(layoutCss, ".full-product-duel-table-central", "overflow")).toContain(
      "overflow: auto"
    );
  });

  it("flows the dense source list into a width-driven multi-column grid", () => {
    const list = block(
      poolCss,
      ".full-product-resource-pool-compact .full-product-resource-pool-action-list"
    );
    expect(list).toContain("display: grid");
    expect(list).toContain("repeat(auto-fill");
    // Buttons may shrink so a long supplied label wraps instead of overflowing.
    expect(
      block(poolCss, ".full-product-resource-pool-compact .full-product-resource-pool-action")
    ).toContain("min-width: 0");
  });

  it("keeps the collapsed resource pool to a small summary row", () => {
    const compact = block(poolCss, ".full-product-resource-pool-compact", "min-height");
    expect(compact).toContain("flex-direction: row");
    expect(compact).toContain("flex-wrap: wrap");
    expect(compact).toContain("min-height: 2.15rem");
    expect(
      block(
        poolCss,
        ".full-product-resource-pool-compact .full-product-resource-pool-details",
        "margin-left"
      )
    ).toContain("margin-left: auto");
  });
});

describe("dense resource row keeps its authority while being visible", () => {
  it("keeps the summary small while retaining all sources behind the detail toggle", () => {
    const html = render({ ...baseProps, paymentSummary: undefined });
    expect(html).toContain(`<summary class="full-product-resource-pool-details-summary">${COMPACT_DETAILS_LABEL}</summary>`);
    expect(html).toContain('class="full-product-resource-pool-details"');
    expect(html).not.toContain('class="full-product-resource-pool-details" open');
    expect(html.indexOf("资源</h3>")).toBeLessThan(html.indexOf("<details"));
    expect(html.indexOf("能量总额")).toBeLessThan(html.indexOf("<details"));
    expect(html.indexOf("符能合计")).toBeLessThan(html.indexOf("<details"));
    for (const action of SOURCE_ACTIONS) {
      expect(html, action.label).toContain(action.label);
    }
    // The source controls remain in the DOM and are revealed by the native
    // disclosure; the collapsed summary does not spend a row on each action.
    const detailsAt = html.indexOf("<details");
    expect(detailsAt).toBeGreaterThan(-1);
    for (const action of SOURCE_ACTIONS) {
      expect(html.indexOf(action.label)).toBeGreaterThan(detailsAt);
    }
    expect(html.indexOf("调整能量")).toBeGreaterThan(detailsAt);
  });

  it("still fails closed: a gated pool disables every supplied source", () => {
    const html = render({ ...baseProps, status: "disconnected" });
    expect(html).toContain("连接已断开，本区只读");
    for (const action of SOURCE_ACTIONS) {
      expect(buttonTag(html, action.label), action.label).toContain("disabled");
    }
  });

  it("surfaces an incomplete projection in the collapsed status chip", () => {
    const html = render({ ...baseProps, energy: { amount: Number.NaN } });
    expect(html).toContain(">数据异常</span>");
    expect(html).toContain("资源数据不完整，本区只读");
  });

  it("keeps the single authoritative payment preview on one short line", () => {
    const html = render(baseProps);
    expect(html).toContain("本次支付");
    expect(html).toContain("能量 2");
    expect(html).toContain("炽烈 1");
    expect(html).toContain(PAYMENT_DISPLAY_ONLY_NOTE);
    // Exactly one preview, never duplicated into the source list.
    expect(html.split("本次支付").length - 1).toBe(1);
  });
});
