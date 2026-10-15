import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  PAYMENT_DISPLAY_ONLY_NOTE,
  PAYMENT_PHASE_NOTE,
  SOURCE_GROUP_GOLD_LABEL,
  SOURCE_GROUP_RUNE_LABEL,
  ResourcePoolPanel,
  compactResourceNotice,
  groupResourceSources,
  resolveResourceActionRequest
} from "../../src/full-product/components/ResourcePoolPanel";
import type {
  ResourceActionView,
  ResourceGateState,
  ResourcePoolPanelProps,
  ResourcePoolStatus,
  ResourcePowerView
} from "../../src/full-product/components/ResourcePoolPanel";

/**
 * Redesign coverage for the duel resource zone.
 *
 * The redesign is presentation-only: tagged sources are grouped under 符文 /
 * 金币 headings, the panel carries one chain/payment-phase reminder, and the
 * compact mode stays the default short summary row. These tests render the real
 * `ResourcePoolPanel` and fire its real button handlers (this package's vitest
 * runs in a DOM-free `node` environment), so the invariants that must NOT change
 * are pinned alongside the new visuals: the fail-closed gate, the supplied-only
 * action ids, and the single authoritative payment preview.
 */

const SIX_DOMAINS_AND_ANY: readonly ResourcePowerView[] = [
  { id: "Fury", label: "炽烈", amount: 1 },
  { id: "Calm", label: "翠意", amount: 1 },
  { id: "Mind", label: "灵光", amount: 1 },
  { id: "Body", label: "摧破", amount: 1 },
  { id: "Chaos", label: "混沌", amount: 1 },
  { id: "Order", label: "序理", amount: 1 },
  { id: "any", label: "任意", amount: 2 }
];

const TAGGED_SOURCES: readonly ResourceActionView[] = [
  { id: "rune-energy", label: "横置符文 +1 能量", enabled: true, sourceKind: "rune" },
  { id: "gold-power", label: "横置并消灭金币 +1 任意符能", enabled: true, sourceKind: "gold" }
];

function makeProps(overrides: Partial<ResourcePoolPanelProps> = {}): ResourcePoolPanelProps {
  return {
    energy: { amount: 2 },
    powers: SIX_DOMAINS_AND_ANY,
    sourceActions: [],
    counterActions: [],
    status: "connected",
    commandPending: false,
    ended: false,
    onAction: () => {},
    ...overrides
  };
}

function render(props: ResourcePoolPanelProps): string {
  return renderToStaticMarkup(<ResourcePoolPanel {...props} />);
}

function ariaText(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `aria node ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.indexOf(">", index);
  const close = html.indexOf("<", open + 1);
  return html.slice(open + 1, close);
}

function buttonTag(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `button ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<button", index);
  const close = html.indexOf(">", index);
  return html.slice(open, close + 1);
}

interface ElementLike {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

function findButton(node: unknown, ariaLabel: string): ElementLike | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, ariaLabel);
      if (found) return found;
    }
    return null;
  }
  if (node === null || typeof node !== "object") return null;
  const element = node as ElementLike;
  if (element.type === "button" && element.props["aria-label"] === ariaLabel) return element;
  return findButton(element.props.children, ariaLabel);
}

/** Fire the panel's real button handler exactly as a browser click would. */
function click(props: ResourcePoolPanelProps, ariaLabel: string): void {
  const tree = ResourcePoolPanel(props);
  const button = findButton(tree, ariaLabel);
  expect(button, `button ${ariaLabel} not found in the rendered tree`).not.toBeNull();
  const onClick = button!.props.onClick as (() => void) | undefined;
  expect(typeof onClick).toBe("function");
  onClick!();
}

const OPEN_GATE: ResourceGateState = {
  status: "connected",
  commandPending: false,
  ended: false,
  projectionComplete: true
};

describe("resource zone redesign: compact is the default dense summary", () => {
  it("groups tagged sources under 符文 / 金币 headings while keeping every action", () => {
    const html = render(makeProps({ compact: true, sourceActions: TAGGED_SOURCES }));
    expect(html).toContain(SOURCE_GROUP_RUNE_LABEL);
    expect(html).toContain(SOURCE_GROUP_GOLD_LABEL);
    expect(html).toContain('data-source-kind="rune"');
    expect(html).toContain('data-source-kind="gold"');
    for (const action of TAGGED_SOURCES) {
      expect(html, action.label).toContain(action.label);
    }
    // The 符文 heading is above its rune button and the 金币 heading above gold.
    expect(html.indexOf(SOURCE_GROUP_RUNE_LABEL)).toBeLessThan(
      html.indexOf(TAGGED_SOURCES[0]!.label)
    );
    expect(html.indexOf(SOURCE_GROUP_GOLD_LABEL)).toBeLessThan(
      html.indexOf(TAGGED_SOURCES[1]!.label)
    );
  });

  it("renders one flat list with no group wrapper when no source is tagged", () => {
    const untagged: readonly ResourceActionView[] = [
      { id: "gain-energy", label: "横置符文 +1 能量", enabled: true },
      { id: "recycle", label: "回收符文 +1 翠意符能", enabled: true }
    ];
    const html = render(makeProps({ compact: true, sourceActions: untagged }));
    expect(html).not.toContain("full-product-resource-pool-source-group");
    expect(html).not.toContain("data-source-kind");
    expect(html).toContain('class="full-product-resource-pool-action-list"');
  });

  it("stays a short summary row: headline totals precede the details disclosure", () => {
    const html = render(makeProps({ compact: true, sourceActions: TAGGED_SOURCES }));
    expect(html).toContain("full-product-resource-pool-compact");
    expect(html.indexOf("资源</h3>")).toBeLessThan(html.indexOf("<details"));
    expect(html.indexOf("能量总额")).toBeLessThan(html.indexOf("<details"));
    expect(html.indexOf("符能合计")).toBeLessThan(html.indexOf("<details"));
    // Sources and the group headings live inside the on-demand disclosure.
    const detailsAt = html.indexOf("<details");
    expect(html.indexOf(SOURCE_GROUP_RUNE_LABEL)).toBeGreaterThan(detailsAt);
  });

  it("keeps the two energy/power domains distinct and the counts verbatim", () => {
    const html = render(makeProps({ compact: true }));
    expect(ariaText(html, "能量总额")).toBe("2");
    expect(ariaText(html, "符能合计")).toBe("8");
    expect(ariaText(html, "当前任意符能")).toBe("2");
  });
});

describe("resource zone redesign: payment-phase reminder", () => {
  it("shows the chained/payment reminder next to the display-only payment note", () => {
    const html = render(
      makeProps({
        compact: true,
        paymentSummary: {
          label: "本次支付",
          energyCost: 2,
          powerCosts: [{ label: "炽烈", amount: 1 }]
        }
      })
    );
    expect(html).toContain("本次支付");
    expect(html).toContain("能量 2");
    expect(html).toContain("炽烈 1");
    expect(html).toContain(PAYMENT_DISPLAY_ONLY_NOTE);
    expect(html).toContain(PAYMENT_PHASE_NOTE);
    // Exactly one preview, never duplicated.
    expect(html.split("本次支付").length - 1).toBe(1);
  });

  it("renders the same reminder in the full-height panel", () => {
    const html = render(
      makeProps({
        paymentSummary: { label: "本次支付", energyCost: 1 }
      })
    );
    expect(html).toContain(PAYMENT_DISPLAY_ONLY_NOTE);
    expect(html).toContain(PAYMENT_PHASE_NOTE);
  });

  it("never shows a payment preview or phase note when no cost is supplied", () => {
    const html = render(makeProps({ compact: true }));
    expect(html).not.toContain("本次支付");
    expect(html).not.toContain(PAYMENT_DISPLAY_ONLY_NOTE);
    expect(html).not.toContain(PAYMENT_PHASE_NOTE);
  });
});

describe("resource zone redesign: authority is unchanged", () => {
  it("forwards only the exact supplied, enabled source id — even when grouped", () => {
    const onAction = vi.fn();
    click(makeProps({ compact: true, sourceActions: TAGGED_SOURCES, onAction }), TAGGED_SOURCES[1]!.label);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("gold-power");
  });

  it("keeps a disabled tagged source disabled and never dispatches it", () => {
    const disabled: ResourceActionView = {
      id: "gold-power",
      label: "横置并消灭金币 +1 任意符能",
      enabled: false,
      blockedReason: "金币已横置",
      sourceKind: "gold"
    };
    const html = render(makeProps({ compact: true, sourceActions: [disabled] }));
    expect(buttonTag(html, disabled.label)).toContain("disabled");
    expect(html).toContain("金币已横置");

    const onAction = vi.fn();
    click(makeProps({ compact: true, sourceActions: [disabled], onAction }), disabled.label);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("fails closed while gated: reconnecting/disconnected/pending/ended still block every source", () => {
    const cases: readonly { overrides: Partial<ResourcePoolPanelProps>; notice: string }[] = [
      { overrides: { status: "reconnecting" }, notice: "正在重连，本区只读" },
      { overrides: { status: "disconnected" }, notice: "连接已断开，本区只读" },
      { overrides: { commandPending: true }, notice: "指令处理中，本区只读" },
      { overrides: { ended: true }, notice: "对局已结束，本区只读" }
    ];
    for (const { overrides, notice } of cases) {
      const html = render(makeProps({ compact: true, sourceActions: TAGGED_SOURCES, ...overrides }));
      expect(html, notice).toContain(notice);
      for (const action of TAGGED_SOURCES) {
        expect(buttonTag(html, action.label), action.label).toContain("disabled");
      }
      const onAction = vi.fn();
      click(
        makeProps({ compact: true, sourceActions: TAGGED_SOURCES, ...overrides, onAction }),
        TAGGED_SOURCES[0]!.label
      );
      expect(onAction, notice).not.toHaveBeenCalled();
    }
  });

  it("fails the whole zone closed on a broken projection and never fakes a total", () => {
    const html = render(makeProps({ compact: true, energy: { amount: -1 } }));
    expect(html).toContain("资源数据不完整，本区只读");
    expect(ariaText(html, "能量总额")).toBe("—");
    expect(html).not.toContain("NaN");
  });
});

describe("resource zone redesign: stale projections", () => {
  it("renders equal props identically and never mutates the supplied balances", () => {
    const energy = Object.freeze({ amount: 5 });
    const powers = Object.freeze([...SIX_DOMAINS_AND_ANY]);
    const sources = Object.freeze([...TAGGED_SOURCES]);
    const props = makeProps({ compact: true, energy, powers, sourceActions: sources });
    const first = render(props);
    const second = render(props);
    expect(second).toBe(first);
    expect(energy.amount).toBe(5);
    expect(ariaText(second, "能量总额")).toBe("5");
  });

  it("shows the newest server balance verbatim across two frames (no client drift)", () => {
    const stale = render(makeProps({ compact: true, energy: { amount: 9 } }));
    const fresh = render(makeProps({ compact: true, energy: { amount: 1 } }));
    expect(ariaText(stale, "能量总额")).toBe("9");
    expect(ariaText(fresh, "能量总额")).toBe("1");
  });
});

describe("resource zone redesign: grouping helper", () => {
  it("returns one unnamed group for untagged sources (flat, order preserved)", () => {
    const untagged: readonly ResourceActionView[] = [
      { id: "b", label: "b", enabled: true },
      { id: "a", label: "a", enabled: true }
    ];
    const groups = groupResourceSources(untagged);
    expect(groups).toEqual([{ kind: "all", label: "", actions: untagged }]);
  });

  it("splits rune and gold into labelled groups while never dropping an action", () => {
    const mixed: readonly ResourceActionView[] = [
      { id: "g1", label: "g1", enabled: true, sourceKind: "gold" },
      { id: "r1", label: "r1", enabled: true, sourceKind: "rune" },
      { id: "r2", label: "r2", enabled: true, sourceKind: "rune" },
      { id: "u1", label: "u1", enabled: true }
    ];
    const groups = groupResourceSources(mixed);
    expect(groups.map(group => group.kind)).toEqual(["rune", "gold", "all"]);
    const runes = groups.find(group => group.kind === "rune")!;
    expect(runes.label).toBe(SOURCE_GROUP_RUNE_LABEL);
    expect(runes.actions.map(action => action.id)).toEqual(["r1", "r2"]);
    const gold = groups.find(group => group.kind === "gold")!;
    expect(gold.label).toBe(SOURCE_GROUP_GOLD_LABEL);
    expect(gold.actions.map(action => action.id)).toEqual(["g1"]);
    // Every supplied id still appears exactly once across the groups.
    const allIds = groups.flatMap(group => group.actions.map(action => action.id)).sort();
    expect(allIds).toEqual(["g1", "r1", "r2", "u1"]);
  });

  it("returns no group for an empty source list", () => {
    expect(groupResourceSources([])).toEqual([]);
  });
});

describe("resource zone redesign: gate helper stays fail-closed", () => {
  it("reports a plain-language notice for the compact chip and null only when open", () => {
    expect(compactResourceNotice(OPEN_GATE)).toBeNull();
    expect(compactResourceNotice({ ...OPEN_GATE, projectionComplete: false })).toBe(
      "资源数据不完整，本区只读"
    );
    const blocked: ResourcePoolStatus[] = ["reconnecting", "disconnected", "waiting"];
    for (const status of blocked) {
      expect(compactResourceNotice({ ...OPEN_GATE, status })).not.toBeNull();
    }
  });

  it("still refuses an unknown or disabled action id across the gate states", () => {
    const sources = [TAGGED_SOURCES[0]!];
    expect(resolveResourceActionRequest("rune-energy", sources, OPEN_GATE)).toBe("rune-energy");
    expect(resolveResourceActionRequest("gold-power", sources, OPEN_GATE)).toBeNull();
    expect(resolveResourceActionRequest("rune-energy", sources, { ...OPEN_GATE, ended: true })).toBeNull();
    expect(
      resolveResourceActionRequest("rune-energy", sources, { ...OPEN_GATE, commandPending: true })
    ).toBeNull();
  });
});
