import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { isDuelProjection } from "@riftbound/protocol";
import type { DuelProjection, DuelWireAction, DuelWireMatchPlaying } from "@riftbound/protocol";
import { DUEL_GOLD_UNIVERSAL_TAG, DuelMatchBoard } from "../../src/full-product/DuelMatchBoard";
import type { DuelMatchBoardProps } from "../../src/full-product/DuelMatchBoard";
import {
  PAYMENT_DISPLAY_ONLY_NOTE,
  REPLAY_COMPACT_RESOURCE_READONLY_NOTICE,
  REPLAY_RESOURCE_READONLY_NOTICE,
  REPLAY_RESOURCE_STATUS_LABEL,
  RETENTION_NOTE,
  ResourcePoolPanel
} from "../../src/full-product/components/ResourcePoolPanel";
import type {
  ResourceActionView,
  ResourcePoolPanelProps
} from "../../src/full-product/components/ResourcePoolPanel";

/**
 * Focused replay / recorded-frame read-only tests for the formal Duel resource
 * area.
 *
 * Regression under test: the Board used to pass `commandPending || readOnly`
 * into the panel, so a paused replay frame falsely reported "处理中" / a live
 * connection state. The panel now takes a local `readOnly` flag that gates the
 * whole pool with replay wording and blocks every entry, while every real count,
 * chip, payment preview and action id is preserved verbatim.
 *
 * The package's vitest runs in a DOM-free `node` environment, so a click is
 * simulated by invoking the exact `onClick` React would bind on the panel's real
 * element tree.
 */

const CARD_TITLES: Readonly<Record<string, string>> = {
  "legend.0": "旧日守望",
  "champ.0": "铁壁先锋",
  "legend.1": "暮色行者",
  "champ.1": "疾风刺客",
  "field.0.0": "迷雾峡谷",
  "field.1.0": "焦土废墟"
};
const resolveCardTitle = (cardId: string): string => CARD_TITLES[cardId] ?? cardId;

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

const WIRE_ENERGY: DuelWireAction = {
  id: "src-energy",
  kind: "rune-energy",
  label: "横置符文 +1 能量",
  enabled: true,
  uid: "p1-rune-1"
};
const WIRE_GOLD: DuelWireAction = {
  id: "src-gold",
  kind: "gold-power",
  label: "横置并消灭金币 +1 任意符能",
  enabled: true,
  uid: "p1-gold-1"
};
const WIRE_PAY: DuelWireAction = {
  id: "pay-1",
  kind: "pay-pending",
  label: "支付符文费用",
  enabled: true,
  paymentId: "pay-1",
  resolvedCost: { energy: 2, power: [{ allowedDomains: ["Fury"], amount: 1 }] }
};

const VIEW_ENERGY: ResourceActionView = { id: "src-energy", label: WIRE_ENERGY.label, enabled: true };
const VIEW_GOLD: ResourceActionView = {
  id: "src-gold",
  label: WIRE_GOLD.label,
  detail: DUEL_GOLD_UNIVERSAL_TAG,
  enabled: true
};
const VIEW_COUNTER: ResourceActionView = {
  id: "counter-energy",
  label: "调整能量",
  enabled: true
};

/** A minimal, wire-legal playing projection (guard-asserted in each test). */
function playingProjection(options: {
  readonly viewer: string | null;
  readonly energy: number;
  readonly fury: number;
  readonly any: number;
  readonly actions: readonly DuelWireAction[];
  readonly frameCost: { readonly energy: number; readonly fury: number } | null;
}): DuelProjection {
  const { viewer, energy, fury, any, actions, frameCost } = options;
  const pending =
    frameCost === null
      ? null
      : {
          active: true as const,
          paymentId: "pay-1",
          resolvedCost: {
            energy: frameCost.energy,
            power: [{ allowedDomains: ["Fury" as const], amount: frameCost.fury }]
          }
        };
  const match: DuelWireMatchPlaying = {
    schemaVersion: 1,
    rulesetId: "riftbound-duel",
    matchId: "match-replay",
    dataVersion: "data-1",
    catalogDigest: "digest-1",
    stateVersion: 7,
    eventSeq: 7,
    roster: [
      { playerId: "p1", displayName: "Player 1" },
      { playerId: "p2", displayName: "Player 2" }
    ],
    turnOrder: ["p1", "p2"],
    stage: "playing",
    players: [
      {
        playerId: "p1",
        champion: { cardId: "champ.0" },
        legend: { cardId: "legend.0" },
        handCount: 2,
        mainDeckCount: 3,
        hand: [{ uid: "p1-main-1", cardId: "card.0.1" }, { uid: "p1-main-2", cardId: "card.0.2" }],
        trash: []
      },
      {
        playerId: "p2",
        champion: { cardId: "champ.1" },
        legend: { cardId: "legend.1" },
        handCount: 2,
        mainDeckCount: 3,
        trash: []
      }
    ],
    board: {
      bases: [
        { locationId: '["duel-base","p1"]', ownerPlayerId: "p1", occupancy: [] },
        { locationId: '["duel-base","p2"]', ownerPlayerId: "p2", occupancy: [] }
      ],
      battlefields: [
        {
          locationId: '["duel-battlefield","p1-field-0"]',
          instanceId: "p1-field-0",
          cardId: "field.0.0",
          ownerPlayerId: "p1",
          controllerPlayerId: null,
          contested: false,
          contestingPlayerId: null,
          showdown: "none",
          combat: "none",
          occupancy: []
        },
        {
          locationId: '["duel-battlefield","p2-field-0"]',
          instanceId: "p2-field-0",
          cardId: "field.1.0",
          ownerPlayerId: "p2",
          controllerPlayerId: null,
          contested: false,
          contestingPlayerId: null,
          showdown: "none",
          combat: "none",
          occupancy: []
        }
      ],
      units: []
    },
    resources: {
      players: [
        {
          playerId: "p1",
          runePool: {
            energy,
            power: { Fury: fury, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any }
          },
          runeDeckCount: 5
        },
        {
          playerId: "p2",
          runePool: { energy: 1, power: { Fury: 0, Calm: 0, Mind: 0, Body: 0, Chaos: 0, Order: 0, any: 0 } },
          runeDeckCount: 6
        }
      ],
      bases: [
        {
          playerId: "p1",
          locationId: '["duel-base","p1"]',
          baseRunes: [
            {
              uid: "p1-rune-1",
              cardId: "rune.0.1",
              domain: "Fury",
              readied: true,
              ownerPlayerId: "p1",
              controllerPlayerId: "p1",
              locationId: '["duel-base","p1"]'
            }
          ],
          goldTokens: [
            {
              uid: "p1-gold-1",
              readied: true,
              ownerPlayerId: "p1",
              controllerPlayerId: "p1",
              locationId: '["duel-base","p1"]'
            }
          ]
        },
        { playerId: "p2", locationId: '["duel-base","p2"]', baseRunes: [], goldTokens: [] }
      ]
    },
    scoring: {
      playerIds: ["p1", "p2"],
      battlefieldLocationIds: [
        '["duel-battlefield","p1-field-0"]',
        '["duel-battlefield","p2-field-0"]'
      ],
      victoryScore: 8,
      turnNumber: 2,
      players: [
        { playerId: "p1", points: 0, scoredBattlefieldLocationIds: [] },
        { playerId: "p2", points: 0, scoredBattlefieldLocationIds: [] }
      ]
    },
    frame: {
      phase: "main",
      turnNumber: 2,
      turnPlayerId: "p1",
      priorityPlayerId: "p1",
      focusPlayerId: null,
      stateOpen: true,
      pendingPayment: viewer === null ? null : pending
    }
  };
  return { projectionSchema: "riftbound-duel-v1", viewerPlayerId: viewer, match, actions };
}

const boardProps: Omit<DuelMatchBoardProps, "projection"> = {
  connectionStatus: "connected",
  commandPending: false,
  onCommand: () => {},
  resolveCardTitle
};

function renderBoard(props: DuelMatchBoardProps): string {
  return renderToStaticMarkup(<DuelMatchBoard {...props} />);
}

function makeReplayPanelProps(overrides: Partial<ResourcePoolPanelProps> = {}): ResourcePoolPanelProps {
  return {
    compact: true,
    energy: { amount: 4, increaseActionId: "src-energy", decreaseActionId: "src-energy" },
    powers: [
      { id: "Fury", label: "炽烈", amount: 1, increaseActionId: "src-energy" },
      { id: "Calm", label: "翠意", amount: 0 },
      { id: "Mind", label: "灵光", amount: 0 },
      { id: "Body", label: "摧破", amount: 0 },
      { id: "Chaos", label: "混沌", amount: 0 },
      { id: "Order", label: "序理", amount: 0 },
      { id: "any", label: "任意", amount: 2 }
    ],
    sourceActions: [VIEW_ENERGY, VIEW_GOLD],
    counterActions: [VIEW_COUNTER],
    status: "connected",
    commandPending: false,
    readOnly: true,
    ended: false,
    onAction: () => {},
    ...overrides
  };
}

function renderPanel(props: ResourcePoolPanelProps): string {
  return renderToStaticMarkup(<ResourcePoolPanel {...props} />);
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
  // The panel delegates its +/- entries to a small function component, so walk
  // its rendered output too (safe here: those components use no hooks).
  if (typeof element.type === "function") {
    const rendered = (element.type as (props: Record<string, unknown>) => unknown)(element.props);
    const found = findButton(rendered, ariaLabel);
    if (found) return found;
  }
  return findButton(element.props.children, ariaLabel);
}

function click(panelProps: ResourcePoolPanelProps, ariaLabel: string): void {
  const tree = ResourcePoolPanel(panelProps);
  const button = findButton(tree, ariaLabel);
  expect(button, `button ${ariaLabel} not found in the rendered tree`).not.toBeNull();
  const onClick = button!.props.onClick as (() => void) | undefined;
  expect(typeof onClick).toBe("function");
  onClick!();
}

describe("replay read-only resource pool: wording", () => {
  it("labels a recorded frame as replay read-only and never claims processing or a connection", () => {
    const html = renderPanel(makeReplayPanelProps());

    // Proper replay wording is present.
    expect(html).toContain(REPLAY_COMPACT_RESOURCE_READONLY_NOTICE);
    expect(html).toContain(REPLAY_RESOURCE_STATUS_LABEL);
    // It never claims an in-flight command or a live connection.
    expect(html).not.toContain("指令处理中");
    expect(html).not.toContain("处理中");
    expect(html).not.toContain("已连接");
    expect(html).not.toContain("连接状态：");
  });

  it("uses the full-height replay wording when not compact, still with no connection claim", () => {
    const html = renderPanel(makeReplayPanelProps({ compact: false }));

    expect(html).toContain(REPLAY_RESOURCE_READONLY_NOTICE);
    expect(html).toContain(REPLAY_RESOURCE_STATUS_LABEL);
    expect(html).not.toContain("指令处理中");
    expect(html).not.toContain("连接状态：");
  });

  it("keeps the recorded frame read-only even while the replay transport is connected", () => {
    const projection = playingProjection({
      viewer: "p1",
      energy: 4,
      fury: 1,
      any: 2,
      actions: [WIRE_ENERGY, WIRE_GOLD, WIRE_PAY],
      frameCost: { energy: 2, fury: 1 }
    });
    expect(isDuelProjection(projection)).toBe(true);
    const html = renderBoard({ ...boardProps, projection, readOnly: true });

    expect(html).toContain(REPLAY_COMPACT_RESOURCE_READONLY_NOTICE);
    expect(html).toContain(REPLAY_RESOURCE_STATUS_LABEL);
    expect(html).not.toContain("指令处理中");
  });

  it("defaults to false: an interactive board still reports the live connection state", () => {
    const projection = playingProjection({
      viewer: "p1",
      energy: 4,
      fury: 1,
      any: 2,
      actions: [WIRE_ENERGY, WIRE_GOLD],
      frameCost: null
    });
    const html = renderBoard({ ...boardProps, projection });

    expect(html).toContain("已连接");
    expect(html).not.toContain(REPLAY_COMPACT_RESOURCE_READONLY_NOTICE);
  });
});

describe("replay read-only resource pool: presentation is preserved verbatim", () => {
  it("keeps the real counts, chips, source ids and payment preview while read-only", () => {
    const html = renderPanel(
      makeReplayPanelProps({
        paymentSummary: { label: "本次支付", energyCost: 2, powerCosts: [{ label: "炽烈", amount: 1 }] }
      })
    );

    // Authoritative counts verbatim: energy headline + summed power + chips.
    expect(ariaText(html, "能量总额")).toBe("4");
    expect(ariaText(html, "符能合计")).toBe("3");
    for (const label of ["炽烈", "翠意", "灵光", "摧破", "混沌", "序理", "任意"]) {
      expect(html).toContain(label);
    }
    // Real server labels and ids survive unchanged.
    expect(html).toContain(VIEW_ENERGY.label);
    expect(html).toContain(VIEW_GOLD.label);
    expect(html).toContain(DUEL_GOLD_UNIVERSAL_TAG);
    expect(buttonTag(html, VIEW_ENERGY.label)).toContain('class="full-product-resource-pool-action"');
    // The display-only payment preview stays visible (auto-opened details).
    expect(html).toMatch(/<details[^>]*\sopen=""/);
    expect(html).toContain("本次支付");
    expect(html).toContain("能量 2");
    expect(html).toContain("炽烈 1");
    expect(html).toContain(PAYMENT_DISPLAY_ONLY_NOTE);
    // Retention note is untouched.
    expect(html).toContain(RETENTION_NOTE);
  });
});

describe("replay read-only resource pool: every entry is blocked", () => {
  it("disables every source and counter button and never dispatches even when invoked", () => {
    for (const label of [VIEW_ENERGY.label, VIEW_GOLD.label, VIEW_COUNTER.label]) {
      const onAction = vi.fn();
      const html = renderPanel(makeReplayPanelProps({ onAction }));
      expect(buttonTag(html, label), label).toContain("disabled");
      click(makeReplayPanelProps({ onAction }), label);
      expect(onAction, label).not.toHaveBeenCalled();
    }
  });

  it("disables every +/- step button and never dispatches even when invoked", () => {
    const onAction = vi.fn();
    // The +/- step entries belong to the full-height layout (compact shows the
    // headline totals + chips), so exercise the non-compact replay render.
    const props = makeReplayPanelProps({ compact: false, onAction });
    const html = renderPanel(props);
    for (const label of ["增加能量", "减少能量", "增加炽烈符能", "减少炽烈符能"]) {
      expect(buttonTag(html, label), label).toContain("disabled");
      click(props, label);
    }
    expect(onAction).not.toHaveBeenCalled();
  });

  it("still fails closed in replay when the projection is incomplete", () => {
    const onAction = vi.fn();
    const html = renderPanel(
      makeReplayPanelProps({ energy: { amount: -1 }, onAction })
    );
    expect(html).toContain("资源数据不完整，本区只读");
    expect(ariaText(html, "能量总额")).toBe("—");
    expect(buttonTag(html, VIEW_ENERGY.label)).toContain("disabled");
    click(makeReplayPanelProps({ energy: { amount: -1 }, onAction }), VIEW_ENERGY.label);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("leaves the interactive (default) gating unchanged outside replay", () => {
    const onAction = vi.fn();
    const props = makeReplayPanelProps({ readOnly: false, onAction });
    const html = renderPanel(props);
    expect(buttonTag(html, VIEW_ENERGY.label)).not.toContain("disabled");
    expect(html).toContain("已连接");
    click(props, VIEW_ENERGY.label);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("src-energy");
  });
});
