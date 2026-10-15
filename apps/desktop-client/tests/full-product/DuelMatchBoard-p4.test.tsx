import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
  isDuelCommandMessageV3Actions1,
  isDuelProjectionAny,
  isDuelProjectionMessageTransport,
  isDuelProjectionV2,
  isDuelProjectionV3Actions1,
  type DuelActionV3Actions1,
  type DuelCommandMessageV3Actions1,
  type DuelProjectionV3Actions1
} from "@riftbound/protocol";
import {
  DUEL_BASE_RUNE_LABEL,
  DUEL_GOLD_LABEL,
  DUEL_GEAR_ATTACH_LABEL,
  DUEL_GEAR_SECTION_LABEL,
  DUEL_LEGEND_CONTROLLER_LABEL,
  DUEL_MAIN_DECK_LABEL,
  DUEL_RUNE_DECK_LABEL,
  DUEL_SPECTATOR_HAND_NOTICE,
  DUEL_SPECTATOR_RESOURCE_NOTICE,
  DUEL_TRASH_LABEL,
  DuelMatchBoard
} from "../../src/full-product/DuelMatchBoard";
import type { DuelMatchBoardProps } from "../../src/full-product/DuelMatchBoard";
import {
  DUEL_ACTIONS_PANEL_LABEL,
  DUEL_ACTIONS_NO_ACTIONS_NOTICE,
  DUEL_ACTIONS_SPECTATOR_NOTICE,
  duelActionsGateReason
} from "../../src/full-product/components/DuelActionsPanelV3";

/*
 * Focused P4 board regressions for the *real* formal Duel surface. They render
 * one real P4 DTO (converted in-test from a tracked wire fixture, then asserted
 * with the production `isDuelProjectionV3Actions1` guard) and check only the
 * seams Root wired: the P4 actions panel, the compact resource view, the real
 * legacy resource block still present, Chinese labels, and the spectator /
 * incomplete-connection read-only gates.
 *
 * A guard pass is structural only — the fixture is a wire shape, not a recorded
 * human match and not authority over IR/window/cost/actor.
 */

const BASE_P1 = JSON.stringify(["duel-base", "p1"]);
const FIELD_P1 = JSON.stringify(["duel-battlefield", "p1-field-0"]);

const v2Fixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../../packages/protocol/test/fixtures/duel-v2-projection.json", import.meta.url
)), "utf8")) as Record<string, Record<string, unknown>>;

const CARD_TITLES: Readonly<Record<string, string>> = {
  "legend.0": "旧日守望",
  "champ.0": "铁壁先锋",
  "legend.1": "暮色行者",
  "champ.1": "疾风刺客",
  "card.0.1": "符文学徒",
  "card.0.2": "战地医师",
  "card.0.3": "边境游侠",
  "card.0.4": "秘仪研习",
  "field.0.0": "迷雾峡谷",
  "field.1.0": "焦土废墟",
  "rune.Fury": "炽烈符文"
};
const resolveCardTitle = (cardId: string): string => CARD_TITLES[cardId] ?? cardId;

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

function buttonTag(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `button ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<button", index);
  const close = html.indexOf(">", index);
  return html.slice(open, close + 1);
}

interface BoardOptions {
  readonly viewer?: string | null;
  readonly units?: boolean;
  readonly gears?: boolean;
  readonly actions?: readonly DuelActionV3Actions1[];
}

/**
 * Build a real P4 DTO from the tracked V2 fixture: profile + `schemaVersion`
 * move to P4, V2 legends gain the V3 permanent fields, `board.gears` is added
 * and the frame gains chain/pendingChoice/execution. The result is asserted
 * with the production guard, so it is true P4 wire — never a bespoke test double
 * and never a dependency on the gitignored `outputs` catalog.
 */
function p4Projection(options: BoardOptions = {}): DuelProjectionV3Actions1 {
  const viewer = options.viewer === undefined ? "p1" : options.viewer;
  const source = structuredClone(v2Fixtures["changed"]![viewer === null ? "null" : viewer]) as {
    projectionSchema: string;
    viewerPlayerId: string | null;
    match: {
      schemaVersion: number;
      stage: string;
      players: { playerId: string; legend: { cardId: string } }[];
      board: { bases: { locationId: string; occupancy: string[] }[]; units: unknown[]; gears?: unknown[] };
      frame: Record<string, unknown>;
    };
    actions: readonly unknown[];
  };
  const projection = source as unknown as DuelProjectionV3Actions1;
  source.projectionSchema = DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1;
  source.match.schemaVersion = 3;
  for (const player of source.match.players) {
    (player as { legend: unknown }).legend = {
      cardId: player.legend.cardId,
      controllerPlayerId: player.playerId,
      readiness: "ready"
    };
  }
  if (options.units !== false) {
    source.match.board.units = [{
      objectId: "u1", controllerPlayerId: "p1", locationId: BASE_P1, ownerPlayerId: "p1",
      readied: true, trait: { kind: "card", cardId: "card.0.1" }, totalDamage: 0, damageMarks: []
    }];
    source.match.board.bases[0]!.occupancy = ["u1"];
  }
  source.match.board.gears = options.gears === false ? [] : [{
    uid: "gear-1", cardId: "card.0.2", controllerPlayerId: "p1", locationId: BASE_P1,
    readied: true, attachedToUID: "u1"
  }];
  source.match.frame.chain = { active: false };
  source.match.frame.pendingChoice = null;
  source.match.frame.execution = { status: "ready" };
  (source as { actions: readonly unknown[] }).actions = options.actions ?? [];
  // The board and the wire envelope must both be real P4.
  expect(isDuelProjectionV3Actions1(projection)).toBe(true);
  expect(isDuelProjectionMessageTransport({ type: "duel-projection", roomId: "room-1", projection })).toBe(true);
  expect(isDuelProjectionAny(projection)).toBe(false);
  expect(isDuelProjectionV2(projection)).toBe(false);
  return projection;
}

const END_TURN: DuelActionV3Actions1 = {
  id: "act-end-turn", kind: "end-turn", label: "结束回合", enabled: true, windowId: "w-main"
};

function render(props: Partial<DuelMatchBoardProps> & { projection: DuelProjectionV3Actions1 }): string {
  const full: DuelMatchBoardProps = {
    connectionStatus: "connected",
    commandPending: false,
    onCommand: () => {},
    resolveCardTitle,
    ...props
  };
  return renderToStaticMarkup(<DuelMatchBoard {...full} />);
}

describe("DuelMatchBoard P4 rendering", () => {
  it("renders the full P4 actions panel for a real P4 frame", () => {
    const html = render({ projection: p4Projection({ actions: [END_TURN] }) });
    // The P4 panel is mounted (its own labeled section) and its server action is
    // on screen, enabled, inside the P4 action list.
    expect(html).toContain(DUEL_ACTIONS_PANEL_LABEL);
    expect(html).toContain("结束回合");
    expect(count(html, 'class="full-product-duel-actions-action"')).toBe(1);
    expect(buttonTag(html, "结束回合")).not.toContain("disabled");
  });

  it("keeps the real legacy resource small-block alongside the P4 panel", () => {
    const html = render({ projection: p4Projection({ actions: [END_TURN] }) });
    // The compact resource view is present…
    expect(html).toContain("full-product-resource-pool-compact");
    expect(html).toContain(DUEL_ACTIONS_PANEL_LABEL);
    // …and the real old resource small-block (base runes + gold) is not replaced.
    expect(html).toContain(DUEL_BASE_RUNE_LABEL);
    expect(html).toContain(DUEL_GOLD_LABEL);
    expect(html).toContain(DUEL_MAIN_DECK_LABEL);
    expect(html).toContain(DUEL_RUNE_DECK_LABEL);
    expect(html).toContain(DUEL_TRASH_LABEL);
    expect(html).toContain("炽烈");
  });

  it("renders the Chinese board labels plus the P4 gear/legend permanents", () => {
    const html = render({ projection: p4Projection({ actions: [END_TURN] }) });
    // Legend permanents expose controller + readiness in Chinese.
    expect(html).toContain(DUEL_LEGEND_CONTROLLER_LABEL);
    expect(html).toContain("就绪");
    // The P4 Gear renders with its wire attachment host as a public title.
    expect(html).toContain(DUEL_GEAR_SECTION_LABEL);
    expect(html).toContain(DUEL_GEAR_ATTACH_LABEL);
    expect(html).toContain("战地医师");
    expect(html).toContain("符文学徒");
    // No English/internal vocabulary leaks into player-facing text.
    expect(html).not.toContain("ownerPlayerId");
    expect(html).not.toContain("full-product-duel-actions-legacy-kind");
  });

  it("shows the empty-action notice when a valid P4 frame supplies no actions", () => {
    const html = render({ projection: p4Projection({ actions: [] }) });
    expect(html).toContain(DUEL_ACTIONS_PANEL_LABEL);
    expect(html).toContain(DUEL_ACTIONS_NO_ACTIONS_NOTICE);
    expect(count(html, 'class="full-product-duel-actions-action"')).toBe(0);
  });
});

describe("DuelMatchBoard P4 read-only gates", () => {
  it("renders a spectator P4 frame read-only with the spectator notices", () => {
    const html = render({ projection: p4Projection({ viewer: null }) });
    expect(html).toContain(DUEL_ACTIONS_SPECTATOR_NOTICE);
    expect(html).toContain(DUEL_SPECTATOR_HAND_NOTICE);
    expect(html).toContain(DUEL_SPECTATOR_RESOURCE_NOTICE);
    // A spectator sees no action buttons and no fabrication of hidden state.
    expect(count(html, 'class="full-product-duel-actions-action"')).toBe(0);
    expect(html).not.toContain('type="number"');
  });

  it("disables the P4 action while reconnecting and while a command is pending", () => {
    const reconnecting = render({
      projection: p4Projection({ actions: [END_TURN] }), connectionStatus: "reconnecting"
    });
    expect(buttonTag(reconnecting, "结束回合")).toContain("disabled");
    expect(duelActionsGateReason({
      connectionStatus: "reconnecting", commandPending: false, projectionValid: true, ended: false
    })).not.toBeNull();

    const pending = render({
      projection: p4Projection({ actions: [END_TURN] }), commandPending: true
    });
    expect(buttonTag(pending, "结束回合")).toContain("disabled");
    expect(pending).toContain("指令处理中，界面只读");
  });

  it("renders read-only and dispatches no packet when the connection is disconnected", () => {
    const reported: DuelCommandMessageV3Actions1[] = [];
    const html = render({
      projection: p4Projection({ actions: [END_TURN] }),
      connectionStatus: "disconnected",
      onActionPacket: packet => {
        if (isDuelCommandMessageV3Actions1(packet)) reported.push(packet);
        return true;
      }
    });
    expect(html).toContain("连接已断开，界面只读");
    expect(buttonTag(html, "结束回合")).toContain("disabled");
    // A disabled button never fires a packet; the SSR board cannot click anyway,
    // but the gate reason proves the surface is locked.
    expect(duelActionsGateReason({
      connectionStatus: "disconnected", commandPending: false, projectionValid: true, ended: false
    })).toBe("连接已断开，动作面板已只读");
    expect(reported).toEqual([]);
  });
});

describe("board response timing hand cues", () => {
  function responseProjection() {
    const projection=p4Projection({actions:[]});
    if(projection.match.stage!=="playing") throw Error("playing fixture required");
    const hand=projection.match.players.find(player=>player.playerId==="p1")?.hand;
    if(!hand || hand.length<2) throw Error("two real fixture Hand cards required");
    Object.assign(projection.match.frame,{chain:{active:true,itemCount:1,pendingCount:0},
      pendingPayment:null,pendingChoice:null,stateOpen:false,priorityPlayerId:"p1",execution:{status:"ready"}});
    Object.assign(projection,{actions:[{id:"response-card",kind:"play-card",label:"施放法术",enabled:true,
      cardUID:hand[0]!.uid,windowId:"response-window"},{id:"disabled-card",kind:"play-card",label:"打出单位",
      enabled:false,reason:"当前时点不能打出",cardUID:hand[1]!.uid,windowId:"response-window"}]});
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    return {projection,uid:hand[0]!.uid};
  }
  it("marks only the server-enabled own Hand card in a response window", () => {
    const {projection,uid}=responseProjection();
    const html=render({projection});
    expect(html).toContain("可连锁时点");
    const marked=html.match(/<li[^>]*class="[^"]*full-product-duel-hand-response[^"]*"[^>]*>/g)??[];
    expect(marked).toHaveLength(1); expect(marked[0]).toContain(`data-uid="${uid}"`);
    expect(html).toContain("当前可连锁");
  });
  it("removes response cues while that Chain item is still awaiting payment", () => {
    const {projection}=responseProjection();
    if(projection.match.stage!=="playing") throw Error("playing fixture required");
    Object.assign(projection.match.frame,{pendingPayment:{active:true,paymentId:"payment-for-current-item",
      resolvedCost:{energy:1,power:[]}}});
    Object.assign(projection,{actions:[]});
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    const html=render({projection});
    expect(html).toContain("正在支付施放费用");
    expect(html).not.toContain("full-product-duel-hand-response");
    expect(html).not.toContain("当前可连锁");
  });
});


describe("owner payment resource placement", () => {
  it("uses the payment sidebar only for the payer, including read-only views", () => {
    const projection = p4Projection();
    if (projection.match.stage !== "playing") throw Error("playing required");
    Object.assign(projection.match.frame, { pendingPayment: { active: true, paymentId: "payment-1",
      resolvedCost: { energy: 2, power: [] } } });
    expect(isDuelProjectionV3Actions1(projection)).toBe(true);
    for (const state of [{}, { readOnly: true }, { connectionStatus: "disconnected" as const }]) {
      const html = render({ projection, ...state });
      expect(html).toContain('class="full-product-duel-table-payment-resources"');
      expect(count(html, 'class="full-product-resource-pool full-product-resource-pool-compact"')).toBe(1);
    }
    Object.assign(projection.match.frame, { pendingPayment: { active: true } });
    expect(render({ projection })).not.toContain('class="full-product-duel-table-payment-resources"');
    Object.assign(projection.match.frame, { pendingPayment: null });
    expect(render({ projection })).not.toContain('class="full-product-duel-table-payment-resources"');
    const spectator = p4Projection({ viewer: null });
    expect(render({ projection: spectator })).not.toContain('class="full-product-duel-table-payment-resources"');
  });
});
