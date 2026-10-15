import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { isDuelProjection } from "@riftbound/protocol";
import type { DuelProjection, DuelWireAction, DuelWireMatchPlaying } from "@riftbound/protocol";
import {
  DUEL_GOLD_UNIVERSAL_TAG,
  DUEL_SPECTATOR_RESOURCE_NOTICE,
  DuelMatchBoard,
  resourcePoolPaymentSummary
} from "../../src/full-product/DuelMatchBoard";
import type { DuelMatchBoardProps } from "../../src/full-product/DuelMatchBoard";
import {
  COMPACT_RESOURCE_INCOMPLETE_NOTICE,
  PAYMENT_DISPLAY_ONLY_NOTE,
  RETENTION_HINT,
  RETENTION_NOTE,
  ResourcePoolPanel
} from "../../src/full-product/components/ResourcePoolPanel";
import type {
  ResourceActionView,
  ResourcePoolPanelProps
} from "../../src/full-product/components/ResourcePoolPanel";

/**
 * Focused visibility/payment tests for the formal Duel resource area.
 *
 * They build the *real* DuelMatchBoard / ResourcePoolPanel: static render for
 * markup, plus the panel's real element tree to fire its button handler (this
 * package's vitest runs in a DOM-free `node` environment, so a browser click is
 * simulated by invoking the exact `onClick` React would bind). They assert only
 * the local UI behavior Root fixed — the collapsed summary remains small while
 * "获取资源", retention and the authoritative payment preview stay available
 * through native details. No count, gate or command authority changes here.
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

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

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

/** Wire source/payment actions, exactly as the server projector would emit. */
const WIRE_ENERGY: DuelWireAction = {
  id: "src-energy",
  kind: "rune-energy",
  label: "横置符文 +1 能量",
  enabled: true,
  uid: "p1-rune-1"
};
const WIRE_RECYCLE: DuelWireAction = {
  id: "src-recycle",
  kind: "rune-power",
  label: "回收符文 +1 翠意符能",
  enabled: false,
  reason: "符文已横置",
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

/** The same sources/payment as the panel-level display seam would receive them. */
const VIEW_ENERGY: ResourceActionView = { id: "src-energy", label: WIRE_ENERGY.label, enabled: true };
const VIEW_GOLD: ResourceActionView = {
  id: "src-gold",
  label: WIRE_GOLD.label,
  detail: "通用符能",
  enabled: true
};
const VIEW_RECYCLE_DISABLED: ResourceActionView = {
  id: "src-recycle",
  label: WIRE_RECYCLE.label,
  enabled: false,
  blockedReason: "符文已横置"
};

/**
 * A minimal, wire-legal playing projection. Every key matches the
 * `riftbound-duel-v1` contract exactly (the guard rejects unknown/extra keys),
 * so `isDuelProjection` is asserted on each built fixture.
 *
 * `frameCost` is the authoritative frame `pendingPayment.resolvedCost`; the
 * individual action's own `resolvedCost` (if any) must match it.
 */
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
    matchId: "match-pay",
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
        // The authenticated viewer's hand is projected; for a spectator it must
        // be absent (the guard rejects a spectator hand, and rejects a missing
        // viewer hand), so it is added only for the seated p1 viewer.
        ...(viewer === "p1"
          ? { hand: [{ uid: "p1-main-1", cardId: "card.0.1" }, { uid: "p1-main-2", cardId: "card.0.2" }] }
          : {}),
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

function makePanelProps(overrides: Partial<ResourcePoolPanelProps> = {}): ResourcePoolPanelProps {
  return {
    compact: true,
    energy: { amount: 4 },
    powers: [
      { id: "Fury", label: "炽烈", amount: 1 },
      { id: "Calm", label: "翠意", amount: 0 },
      { id: "Mind", label: "灵光", amount: 0 },
      { id: "Body", label: "摧破", amount: 0 },
      { id: "Chaos", label: "混沌", amount: 0 },
      { id: "Order", label: "序理", amount: 0 },
      { id: "any", label: "任意", amount: 2 }
    ],
    sourceActions: [VIEW_ENERGY],
    status: "connected",
    commandPending: false,
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
  return findButton(element.props.children, ariaLabel);
}

/** Fire the panel's real button handler exactly as a browser click would. */
function click(panelProps: ResourcePoolPanelProps, ariaLabel: string): void {
  const tree = ResourcePoolPanel(panelProps);
  const button = findButton(tree, ariaLabel);
  expect(button, `button ${ariaLabel} not found in the rendered tree`).not.toBeNull();
  const onClick = button!.props.onClick as (() => void) | undefined;
  expect(typeof onClick).toBe("function");
  onClick!();
}

describe("formal compact resource area", () => {
  it("keeps supplied source buttons in the on-demand details", () => {
    const projection = playingProjection({
      viewer: "p1",
      energy: 4,
      fury: 1,
      any: 2,
      actions: [WIRE_ENERGY, WIRE_RECYCLE, WIRE_GOLD, WIRE_PAY],
      frameCost: { energy: 2, fury: 1 }
    });
    expect(isDuelProjection(projection)).toBe(true);
    const html = renderBoard({ ...boardProps, projection });

    // Every real source label is on the board.
    expect(html).toContain(WIRE_ENERGY.label);
    expect(html).toContain(WIRE_RECYCLE.label);
    expect(html).toContain(WIRE_GOLD.label);
    expect(html).toContain(WIRE_RECYCLE.reason!);

    // The compact summary keeps source controls behind one native disclosure.
    const detailsAt = html.indexOf("<details");
    expect(detailsAt).toBeGreaterThanOrEqual(0);
    expect(html.indexOf(WIRE_ENERGY.label)).toBeGreaterThan(detailsAt);
    expect(html.indexOf(WIRE_GOLD.label)).toBeGreaterThan(detailsAt);
    // The retention note and Main-entry clearing hint remain available without
    // occupying the collapsed summary row.
    expect(html.indexOf(RETENTION_NOTE)).toBeGreaterThan(detailsAt);
    expect(html).toContain(RETENTION_HINT);
    // Gold source keeps its universal-power hint and does not add energy.
    expect(html).toContain(DUEL_GOLD_UNIVERSAL_TAG);
    // Energy headline is the verbatim server value.
    expect(ariaText(html, "能量总额")).toBe("4");
  });

  it("opens the compact details while an authoritative payment is outstanding", () => {
    const projection = playingProjection({
      viewer: "p1",
      energy: 4,
      fury: 1,
      any: 2,
      actions: [WIRE_ENERGY, WIRE_PAY],
      frameCost: { energy: 2, fury: 1 }
    });
    expect(isDuelProjection(projection)).toBe(true);
    const html = renderBoard({ ...boardProps, projection });

    const summaryAt = html.indexOf("本次支付");
    expect(html).toMatch(/<details[^>]*\sopen=""/);
    expect(summaryAt).toBeGreaterThanOrEqual(0);
    expect(summaryAt).toBeGreaterThan(html.indexOf("<details"));
    expect(html).toContain(PAYMENT_DISPLAY_ONLY_NOTE);
    // The cost text carries the authoritative energy + domain amounts.
    expect(html).toContain("能量 2");
    expect(html).toContain("炽烈 1");
    // The right-hand payment button is preserved unchanged.
    expect(buttonTag(html, WIRE_PAY.label)).toBeTruthy();
  });

  it("keeps the two battlefields and puts sources/summary inside the resource region", () => {
    const projection = playingProjection({
      viewer: "p1",
      energy: 4,
      fury: 1,
      any: 2,
      actions: [WIRE_ENERGY, WIRE_PAY],
      frameCost: { energy: 2, fury: 1 }
    });
    const html = renderBoard({ ...boardProps, projection });

    // The central battlefield region is unchanged and still renders both real
    // battlefields (each card title also appears in its region aria-label, so
    // presence — not an exact count — is what proves the fields survive).
    expect(count(html, 'class="full-product-duel-table-central"')).toBe(1);
    expect(html).toContain(resolveCardTitle("field.0.0"));
    expect(html).toContain(resolveCardTitle("field.1.0"));
    expect(count(html, 'class="full-product-duel-battlefield"')).toBe(2);

    // The sources and the payment preview live inside the resource region,
    // between the resources region and the hand strip.
    const start = html.indexOf('aria-label="资源池"');
    const end = html.indexOf('aria-label="手牌"', start);
    const region = html.slice(start, end);
    expect(region).toContain(WIRE_ENERGY.label);
    expect(region).toContain("本次支付");
    expect(region).toContain(RETENTION_NOTE);
  });
});

describe("formal resource area: a source click dispatches the original action once", () => {
  it("forwards the supplied source id exactly once", () => {
    const onAction = vi.fn();
    click(makePanelProps({ sourceActions: [VIEW_ENERGY], onAction }), VIEW_ENERGY.label);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("src-energy");
  });

  it("selects the exact source among several without merging or double-firing", () => {
    const onAction = vi.fn();
    click(makePanelProps({ sourceActions: [VIEW_ENERGY, VIEW_GOLD], onAction }), VIEW_GOLD.label);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("src-gold");
  });
});

describe("formal resource area: gates stay fail-closed", () => {
  it("keeps a disabled source disabled and never dispatches it", () => {
    const html = renderPanel(makePanelProps({ sourceActions: [VIEW_RECYCLE_DISABLED] }));
    expect(buttonTag(html, VIEW_RECYCLE_DISABLED.label)).toContain("disabled");
    expect(html).toContain(VIEW_RECYCLE_DISABLED.blockedReason!);

    const onAction = vi.fn();
    click(makePanelProps({ sourceActions: [VIEW_RECYCLE_DISABLED], onAction }), VIEW_RECYCLE_DISABLED.label);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("stays read-only while reconnecting, disconnected, pending or ended and never dispatches", () => {
    const cases: readonly {
      readonly overrides: Partial<ResourcePoolPanelProps>;
      readonly notice: string;
    }[] = [
      { overrides: { status: "reconnecting" }, notice: "正在重连，本区只读" },
      { overrides: { status: "disconnected" }, notice: "连接已断开，本区只读" },
      { overrides: { commandPending: true }, notice: "指令处理中，本区只读" },
      { overrides: { ended: true }, notice: "对局已结束，本区只读" }
    ];
    for (const { overrides, notice } of cases) {
      const html = renderPanel(makePanelProps({ sourceActions: [VIEW_ENERGY], ...overrides }));
      expect(html).toContain(notice);
      expect(buttonTag(html, VIEW_ENERGY.label)).toContain("disabled");

      const onAction = vi.fn();
      click(makePanelProps({ sourceActions: [VIEW_ENERGY], ...overrides, onAction }), VIEW_ENERGY.label);
      expect(onAction, notice).not.toHaveBeenCalled();
    }
  });

  it("fails the whole area closed on a broken projection", () => {
    const html = renderPanel(makePanelProps({ energy: { amount: -1 } }));
    expect(html).toContain(COMPACT_RESOURCE_INCOMPLETE_NOTICE);
    expect(ariaText(html, "能量总额")).toBe("—");
    expect(buttonTag(html, VIEW_ENERGY.label)).toContain("disabled");
  });

  it("lets a spectator see the read-only overview, never an interactive source", () => {
    const projection = playingProjection({
      viewer: null,
      energy: 4,
      fury: 1,
      any: 2,
      actions: [],
      frameCost: null
    });
    expect(isDuelProjection(projection)).toBe(true);
    const html = renderBoard({ ...boardProps, projection });
    expect(html).toContain(DUEL_SPECTATOR_RESOURCE_NOTICE);
    expect(html).not.toContain(WIRE_ENERGY.label);
    expect(html).not.toContain('aria-label="获取资源"');
  });
});

describe("formal resource area: payment preview never fabricates a cost", () => {
  it("shows nothing when the only pending action carries no resolved cost", () => {
    const noCost: DuelWireAction = {
      id: "pay-1",
      kind: "pay-pending",
      label: "支付符文费用",
      enabled: true,
      paymentId: "pay-1"
    };
    expect(resourcePoolPaymentSummary([noCost])).toBeUndefined();

    const projection = playingProjection({
      viewer: "p1",
      energy: 4,
      fury: 1,
      any: 2,
      actions: [WIRE_ENERGY, noCost],
      frameCost: { energy: 2, fury: 1 }
    });
    expect(isDuelProjection(projection)).toBe(true);
    const html = renderBoard({ ...boardProps, projection });
    expect(html).not.toContain("本次支付");
    expect(html).not.toContain(PAYMENT_DISPLAY_ONLY_NOTE);
    // No fabricated zero cost anywhere in the resource area.
    expect(html).not.toContain("能量 0");
  });

  it("does not merge or guess when several payments are pending", () => {
    const other: DuelWireAction = {
      id: "pay-2",
      kind: "pay-pending",
      label: "支付符文费用（备选）",
      enabled: true,
      paymentId: "pay-1"
    };
    expect(resourcePoolPaymentSummary([WIRE_PAY, other])).toBeUndefined();

    const projection = playingProjection({
      viewer: "p1",
      energy: 4,
      fury: 1,
      any: 2,
      actions: [WIRE_ENERGY, WIRE_PAY, other],
      frameCost: { energy: 2, fury: 1 }
    });
    expect(isDuelProjection(projection)).toBe(true);
    const html = renderBoard({ ...boardProps, projection });
    // With more than one pending payment, no single summary is shown.
    expect(html).not.toContain("本次支付");
    // Both real payment buttons are still on the right-hand panel.
    expect(buttonTag(html, WIRE_PAY.label)).toBeTruthy();
    expect(buttonTag(html, other.label)).toBeTruthy();
  });

  it("shows the server balance verbatim and never pre-deducts after a payment", () => {
    const before = playingProjection({
      viewer: "p1",
      energy: 4,
      fury: 1,
      any: 2,
      actions: [WIRE_ENERGY, WIRE_PAY],
      frameCost: { energy: 2, fury: 1 }
    });
    const after = playingProjection({
      viewer: "p1",
      energy: 2,
      fury: 1,
      any: 2,
      actions: [WIRE_ENERGY, WIRE_PAY],
      frameCost: { energy: 2, fury: 1 }
    });
    const beforeHtml = renderBoard({ ...boardProps, projection: before });
    const afterHtml = renderBoard({ ...boardProps, projection: after });
    // 4 → 2 is the server's value in each frame; the resource area only shows it
    // and never subtracts the preview cost on its own.
    expect(ariaText(beforeHtml, "能量总额")).toBe("4");
    expect(ariaText(afterHtml, "能量总额")).toBe("2");
  });
});
