import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  ACTION_BLOCKED_FALLBACK,
  ACTION_NOT_PROVIDED_REASON,
  COMPACT_RESOURCE_INCOMPLETE_NOTICE,
  NO_SOURCE_ACTIONS_NOTICE,
  NO_STEP_ACTION_REASON,
  RETENTION_NOTE,
  ResourcePoolPanel,
  RESOURCE_POOL_INCOMPLETE_NOTICE,
  combineResourceActions,
  compactResourceNotice,
  describeActionDisabledReason,
  describeStepDisabledReason,
  resourceGateReason,
  resolveResourceActionRequest,
  validateResourceCounts
} from "../../src/full-product/components/ResourcePoolPanel";
import type {
  ResourceActionView,
  ResourcePoolPanelProps,
  ResourcePoolStatus,
  ResourcePowerView
} from "../../src/full-product/components/ResourcePoolPanel";

const SIX_DOMAINS_AND_ANY: readonly ResourcePowerView[] = [
  { id: "Fury", label: "炽烈", amount: 1 },
  { id: "Calm", label: "翠意", amount: 1 },
  { id: "Mind", label: "灵光", amount: 1 },
  { id: "Body", label: "摧破", amount: 1 },
  { id: "Chaos", label: "混沌", amount: 1 },
  { id: "Order", label: "序理", amount: 1 },
  { id: "any", label: "任意", amount: 2 }
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

function buttonTag(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `button ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<button", index);
  const close = html.indexOf(">", index);
  return html.slice(open, close + 1);
}

function ariaText(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `aria node ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.indexOf(">", index);
  const close = html.indexOf("<", open + 1);
  return html.slice(open + 1, close);
}

describe("ResourcePoolPanel display", () => {
  it("shows the energy main counter, the power total and every adapter power", () => {
    const html = render(makeProps());
    expect(ariaText(html, "能量总额")).toBe("2");
    expect(ariaText(html, "符能合计")).toBe("8");
    expect(ariaText(html, "当前能量")).toBe("2");
    for (const power of SIX_DOMAINS_AND_ANY) {
      expect(html).toContain(power.label);
      expect(ariaText(html, `当前${power.label}符能`)).toBe(String(power.amount));
    }
    // Six domains + universal power, all rendered individually.
    expect(html.split('class="full-product-resource-pool-line is-power"').length - 1).toBe(7);
    expect(html).toContain(RETENTION_NOTE);
  });

  it("does not hardcode a domain list: it renders exactly the powers it is given", () => {
    const powers: readonly ResourcePowerView[] = [
      { id: "Fury", label: "炽烈", amount: 3 },
      { id: "custom-core", label: "自定义资源", amount: 4 }
    ];
    const html = render(makeProps({ powers }));
    expect(html.split('class="full-product-resource-pool-line is-power"').length - 1).toBe(2);
    expect(html).toContain("自定义资源");
    expect(ariaText(html, "当前自定义资源符能")).toBe("4");
    expect(ariaText(html, "符能合计")).toBe("7");
    // No other domain label is invented or merged into a fake aggregate.
    expect(html).not.toContain("混沌");
    expect(html).not.toContain("任意");
  });

  it("shows an explicit empty state when the layer supplies no source actions", () => {
    const html = render(makeProps({ sourceActions: [] }));
    expect(html).toContain(NO_SOURCE_ACTIONS_NOTICE);
    expect(html).not.toContain('class="full-product-resource-pool-action"');
  });
});

describe("ResourcePoolPanel action gating", () => {
  const gainEnergy: ResourceActionView = {
    id: "gain-energy",
    label: "横置符文 +1 能量",
    detail: "就绪符文",
    enabled: true
  };

  it("enables a +/- entry only when its action id is a real, enabled action", () => {
    const enabled = render(
      makeProps({
        energy: { amount: 2, increaseActionId: "gain-energy" },
        sourceActions: [gainEnergy]
      })
    );
    expect(buttonTag(enabled, "增加能量")).not.toContain("disabled");

    const missing = render(
      makeProps({
        energy: { amount: 2, increaseActionId: "not-supplied" },
        sourceActions: [gainEnergy]
      })
    );
    expect(buttonTag(missing, "增加能量")).toContain("disabled");
    expect(buttonTag(missing, "增加能量")).toContain(ACTION_NOT_PROVIDED_REASON);

    const disabled = render(
      makeProps({
        energy: { amount: 2, increaseActionId: "gain-energy" },
        sourceActions: [{ ...gainEnergy, enabled: false, blockedReason: "符文已横置" }]
      })
    );
    expect(buttonTag(disabled, "增加能量")).toContain("disabled");
    expect(buttonTag(disabled, "增加能量")).toContain("符文已横置");

    const noAction = render(makeProps({ energy: { amount: 2 } }));
    expect(buttonTag(noAction, "增加能量")).toContain("disabled");
    expect(buttonTag(noAction, "增加能量")).toContain(NO_STEP_ACTION_REASON);
  });

  it("resolves an id from the counter list through the unified lookup", () => {
    const html = render(
      makeProps({
        energy: { amount: 2, increaseActionId: "counter-energy" },
        counterActions: [
          { id: "counter-energy", label: "调整能量", enabled: true, blockedReason: undefined }
        ]
      })
    );
    expect(buttonTag(html, "增加能量")).not.toContain("disabled");
  });

  it("renders a disabled source action with its readable blocked reason", () => {
    const html = render(
      makeProps({
        sourceActions: [
          { id: "use-gold", label: "使用金币", enabled: false, blockedReason: "金币已横置" }
        ]
      })
    );
    expect(html).toContain("使用金币");
    expect(html).toContain("金币已横置");
    expect(buttonTag(html, "使用金币")).toContain("disabled");
  });

  it("keeps every entry read-only across disconnected, reconnecting, waiting, pending and ended", () => {
    const sources = [gainEnergy];
    const energy = { amount: 2, increaseActionId: "gain-energy", decreaseActionId: "gain-energy" };
    const cases: Array<{
      label: string;
      overrides: Partial<ResourcePoolPanelProps>;
      reason: string;
    }> = [
      {
        label: "disconnected",
        overrides: { status: "disconnected" },
        reason: "连接已断开，资源池只读"
      },
      {
        label: "reconnecting",
        overrides: { status: "reconnecting" },
        reason: "正在重连，资源池只读"
      },
      { label: "waiting", overrides: { status: "waiting" }, reason: "等待其他玩家，资源池只读" },
      { label: "pending", overrides: { commandPending: true }, reason: "指令处理中，资源池只读" },
      { label: "ended", overrides: { ended: true }, reason: "对局已结束，资源池只读" }
    ];
    for (const testCase of cases) {
      const html = render(makeProps({ energy, sourceActions: sources, ...testCase.overrides }));
      expect(html, testCase.label).toContain(testCase.reason);
      expect(buttonTag(html, "增加能量"), testCase.label).toContain("disabled");
      expect(buttonTag(html, "横置符文 +1 能量"), testCase.label).toContain("disabled");
    }
  });
});

describe("ResourcePoolPanel fail-closed validation", () => {
  it("marks a broken energy count as incomplete and never renders NaN/negatives", () => {
    const html = render(makeProps({ energy: { amount: -1 } }));
    expect(html).toContain(RESOURCE_POOL_INCOMPLETE_NOTICE);
    expect(ariaText(html, "能量总额")).toBe("—");
    expect(ariaText(html, "当前能量")).toBe("—");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("-1");
    expect(buttonTag(html, "增加能量")).toContain("disabled");
  });

  it("fails the whole projection for a broken power instead of hiding it in a plausible total", () => {
    const powers: readonly ResourcePowerView[] = [
      { id: "Fury", label: "炽烈", amount: 3 },
      { id: "Calm", label: "翠意", amount: Number.NaN }
    ];
    const html = render(makeProps({ powers }));
    expect(html).toContain(RESOURCE_POOL_INCOMPLETE_NOTICE);
    // The good power is not shown as a valid number that would imply full credit.
    expect(ariaText(html, "符能合计")).toBe("—");
    expect(ariaText(html, "当前炽烈符能")).toBe("—");
    expect(html).not.toContain(">3<");
    expect(html).not.toContain("NaN");
    expect(buttonTag(html, "增加能量")).toContain("disabled");
  });
});

describe("ResourcePoolPanel stability", () => {
  it("renders identically for equal props and never mutates the balances", () => {
    const energy = Object.freeze({ amount: 5, increaseActionId: "gain-energy" });
    const sourceActions = Object.freeze([
      Object.freeze({ id: "gain-energy", label: "获取能量", enabled: true })
    ]);
    const props: ResourcePoolPanelProps = makeProps({
      energy,
      powers: Object.freeze([...SIX_DOMAINS_AND_ANY]),
      sourceActions
    });
    const first = render(props);
    const second = render(props);
    expect(second).toBe(first);
    expect(energy.amount).toBe(5);
    expect(ariaText(second, "能量总额")).toBe("5");
    expect(ariaText(second, "符能合计")).toBe("8");
  });
});

describe("resource gate authority", () => {
  const openGate = {
    status: "connected" as ResourcePoolStatus,
    commandPending: false,
    ended: false,
    projectionComplete: true
  };
  const gain: ResourceActionView = { id: "gain-energy", label: "获取能量", enabled: true };

  it("returns a reason for every read-only state and null only when fully open", () => {
    expect(resourceGateReason(openGate)).toBeNull();
    expect(resourceGateReason({ ...openGate, ended: true })).toContain("结束");
    expect(resourceGateReason({ ...openGate, status: "disconnected" })).toContain("断开");
    expect(resourceGateReason({ ...openGate, status: "reconnecting" })).toContain("重连");
    expect(resourceGateReason({ ...openGate, status: "waiting" })).toContain("等待");
    expect(resourceGateReason({ ...openGate, commandPending: true })).toContain("处理中");
    // An incomplete projection wins even over an otherwise connected status.
    expect(resourceGateReason({ ...openGate, projectionComplete: false })).toBe(
      RESOURCE_POOL_INCOMPLETE_NOTICE
    );
  });

  it("only dispatches an action id that is supplied, enabled and inside an open gate", () => {
    const actions = [gain];
    expect(resolveResourceActionRequest("gain-energy", actions, openGate)).toBe("gain-energy");
    expect(resolveResourceActionRequest(undefined, actions, openGate)).toBeNull();
    expect(resolveResourceActionRequest("unknown", actions, openGate)).toBeNull();
    expect(
      resolveResourceActionRequest("gain-energy", [{ ...gain, enabled: false }], openGate)
    ).toBeNull();
    expect(
      resolveResourceActionRequest("gain-energy", actions, { ...openGate, commandPending: true })
    ).toBeNull();
    expect(
      resolveResourceActionRequest("gain-energy", actions, { ...openGate, ended: true })
    ).toBeNull();
    expect(
      resolveResourceActionRequest("gain-energy", actions, {
        ...openGate,
        projectionComplete: false
      })
    ).toBeNull();
    expect(
      resolveResourceActionRequest("gain-energy", [], openGate)
    ).toBeNull();
  });

  it("reports the disabled reason precedence used by the +/- entries", () => {
    const actions = [gain, { id: "used", label: "已用", enabled: false, blockedReason: "已横置" }];
    expect(describeStepDisabledReason("gain-energy", actions, openGate)).toBeNull();
    expect(describeStepDisabledReason(undefined, actions, openGate)).toBe(NO_STEP_ACTION_REASON);
    expect(describeStepDisabledReason("unknown", actions, openGate)).toBe(
      ACTION_NOT_PROVIDED_REASON
    );
    expect(describeStepDisabledReason("used", actions, openGate)).toBe("已横置");
    expect(
      describeStepDisabledReason("gain-energy", actions, { ...openGate, ended: true })
    ).toContain("结束");
    expect(describeActionDisabledReason({ id: "x", label: "x", enabled: false }, openGate)).toBe(
      ACTION_BLOCKED_FALLBACK
    );
  });

  it("dedupes ids across source and counter lists (sources win)", () => {
    const combined = combineResourceActions(
      [{ id: "a", label: "source-a", enabled: true }],
      [
        { id: "a", label: "counter-a", enabled: false },
        { id: "b", label: "counter-b", enabled: true }
      ]
    );
    expect(combined.map(action => action.label)).toEqual(["source-a", "counter-b"]);
  });

  it("flags non-integer and negative counts as incomplete", () => {
    expect(validateResourceCounts({ amount: 1.5 }, []).complete).toBe(false);
    expect(validateResourceCounts({ amount: -3 }, []).complete).toBe(false);
    expect(validateResourceCounts({ amount: 0 }, [{ id: "any", label: "任意", amount: 0 }]).complete)
      .toBe(true);
  });
});

describe("ResourcePoolPanel compact row", () => {
  const chipCount = (html: string) =>
    html.split('class="full-product-resource-pool-chip is-power"').length - 1;

  it("renders the two headline totals, one chip per power category and a collapsible source list", () => {
    const html = render(
      makeProps({
        compact: true,
        sourceActions: [{ id: "gain-energy", label: "横置符文 +1 能量", enabled: true }]
      })
    );
    expect(html).toContain("full-product-resource-pool-compact");
    expect(chipCount(html)).toBe(7);
    expect(ariaText(html, "能量总额")).toBe("2");
    expect(ariaText(html, "当前炽烈符能")).toBe("1");
    // The source actions live inside a collapsible detail region.
    expect(html).toContain("<details");
    expect(html).toContain("横置符文 +1 能量");
    // Plain player language only: no implementation vocabulary in the dense view.
    expect(html).not.toContain("上层");
    expect(html).not.toContain("投影");
  });

  it("keeps the dense row read-only and fails closed like the full panel", () => {
    const disconnected = render(
      makeProps({
        compact: true,
        status: "disconnected",
        sourceActions: [{ id: "gain-energy", label: "横置符文 +1 能量", enabled: true }]
      })
    );
    expect(disconnected).toContain("连接已断开，本区只读");
    expect(buttonTag(disconnected, "横置符文 +1 能量")).toContain("disabled");

    const broken = render(makeProps({ compact: true, energy: { amount: -1 } }));
    expect(broken).toContain(COMPACT_RESOURCE_INCOMPLETE_NOTICE);
    expect(ariaText(broken, "能量总额")).toBe("—");
    expect(broken).not.toContain("NaN");

    const openGate = {
      status: "connected" as ResourcePoolStatus,
      commandPending: false,
      ended: false,
      projectionComplete: true
    };
    expect(compactResourceNotice(openGate)).toBeNull();
    expect(compactResourceNotice({ ...openGate, projectionComplete: false })).toBe(
      COMPACT_RESOURCE_INCOMPLETE_NOTICE
    );
    expect(compactResourceNotice({ ...openGate, commandPending: true })).toContain("处理中");
  });

  it("shows both compact headline totals and the real sum of the seven category chips", () => {
    const html = render(makeProps({ compact: true }));
    expect(ariaText(html, "能量总额")).toBe("2");
    // The shown power total equals what the seven visible category chips render,
    // read back from the real component output instead of re-summing the props.
    const shownPowerTotal = Number(ariaText(html, "符能合计"));
    const categorySum = SIX_DOMAINS_AND_ANY.reduce(
      (sum, power) => sum + Number(ariaText(html, `当前${power.label}符能`)),
      0
    );
    expect(categorySum).toBe(shownPowerTotal);
    expect(shownPowerTotal).toBe(8);
    // Exactly one of each headline counter: never duplicated or merged with a chip.
    expect(html.split('aria-label="能量总额"').length - 1).toBe(1);
    expect(html.split('aria-label="符能合计"').length - 1).toBe(1);
  });

  it("shows energy and summed power as two independent counters", () => {
    const html = render(makeProps({ compact: true, energy: { amount: 5 } }));
    expect(ariaText(html, "能量总额")).toBe("5");
    expect(ariaText(html, "符能合计")).toBe("8");
  });

  it("never fakes a zero power total when a category count is broken", () => {
    const powers: readonly ResourcePowerView[] = [
      { id: "Fury", label: "炽烈", amount: 3 },
      { id: "Calm", label: "翠意", amount: Number.NaN }
    ];
    const html = render(makeProps({ compact: true, powers }));
    expect(html).toContain(COMPACT_RESOURCE_INCOMPLETE_NOTICE);
    expect(ariaText(html, "符能合计")).toBe("—");
    // Fail-closed: the energy headline is withheld too, not a fabricated 2 or 0.
    expect(ariaText(html, "能量总额")).toBe("—");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain(">3<");
    expect(html).not.toContain(">0<");
  });
});

describe("ResourcePoolPanel.css scoping", () => {
  it("prefixes every rule so it cannot leak into other styles", () => {
    const css = readFileSync(
      new URL("../../src/full-product/components/ResourcePoolPanel.css", import.meta.url),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = css
      .split("}")
      .map(rule => rule.split("{")[0]?.trim() ?? "")
      .filter(selector => selector.length > 0);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const part of selector.split(",")) {
        expect(part.trim().startsWith(".full-product-resource-pool"), part).toBe(true);
      }
    }
  });
});
