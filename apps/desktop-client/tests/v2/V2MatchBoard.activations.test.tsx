import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { V2MatchBoard, V2ActivationMenu } from "../../src/full-product/v2/V2MatchBoard";
import {
  buildV2ActivateCommand,
  v2ActivationLabel,
  v2ActivationsFor,
  v2ActivationSourceIds
} from "../../src/full-product/v2/activations";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { CatalogCard } from "../../src/net/CardCatalogClient";
import type { V2CommandRequest } from "../../src/transport/v2";
import type { V2ActivationOption, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// RIFT-1183: the server lists activated abilities (RIFT-1167); the board offers
// exactly those and sends `activate`.
const captured = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>
}));

vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  const capture = (type: unknown, props: unknown, ...rest: unknown[]) => {
    if (props && typeof props === "object") captured.props.push(props as Record<string, unknown>);
    return (actual.jsxDEV as (...args: unknown[]) => unknown)(type, props, ...rest);
  };
  return { ...actual, jsxDEV: capture };
});

beforeEach(() => { captured.props.length = 0; });

// Official zh_CN name of sfd-022-221 Long Sword: 长剑.
const longSword = {
  id: "sfd-022-221", name: "Long Sword", localizedName: "长剑", cardType: "Gear", domains: ["Fury"],
  energy: 2, imageUrl: "https://example.test/long-sword.png"
} as unknown as CatalogCard;

const equip: V2ActivationOption = { sourceObjectId: "sword-1", abilityId: "0", label: "Equip" };

function projection(activations?: readonly V2ActivationOption[]): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "rift-1183-activations",
    viewerPlayerId: "alice",
    stateVersion: 9,
    eventSeq: 3,
    phase: "main",
    turnNumber: 4,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 0, energy: 0, power: { fury: 1 }, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} },
      { playerId: "bob", name: "Bob", score: 0, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} }
    ],
    zones: [],
    objects: [
      { objectId: "sword-1", zoneEntryId: 4, zone: "board", ownerPlayerId: "alice", cardId: "sfd-022-221", name: "Long Sword",
        faceDown: false, visibility: "public", location: { kind: "base", playerId: "alice" } },
      { objectId: "mech-1", zoneEntryId: 5, zone: "board", ownerPlayerId: "alice", name: "Mech",
        faceDown: false, visibility: "public", might: 3, location: { kind: "base", playerId: "alice" } }
    ],
    chain: { status: "open", phase: "await-commit", priorityPlayerId: "alice", focusPlayerId: null, items: [] },
    priority: { playerId: "alice", focusPlayerId: null, window: "main" },
    scoring: {
      victoryScore: 8,
      battlefieldLocationIds: [],
      players: [
        { playerId: "alice", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
        { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
      ]
    },
    battlefields: [],
    combat: { status: "none" },
    actionOptions: { canEndTurn: true, canAdvance: false, moves: [], plays: [],
      ...(activations === undefined ? {} : { activations }) },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: []
  } as V2Projection;
}

function render(value: V2Projection, onCommand = vi.fn(async (_request: V2CommandRequest) => ({
  type: "command-receipt" as const, protocolVersion: "2.0.0", commandId: "test", stateVersion: 10, eventSeq: 4,
  accepted: true, duplicate: false, rejection: null
}))): { readonly html: string; readonly onCommand: typeof onCommand } {
  const state: V2ClientState = {
    ...createV2ClientState({ viewerPlayerId: "alice", now: 0, choiceTimeoutMs: 10_000 }),
    connectionStatus: "connected",
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "alice", now: 0, timeoutMs: 10_000 })
  };
  const html = renderToStaticMarkup(<V2MatchBoard state={state} initialCatalogCards={[longSword]} onCommand={onCommand} />);
  return { html, onCommand };
}

function activationSection(html: string): string {
  const start = html.indexOf('aria-label="可发动的能力"');
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
}

describe("RIFT-1183 activated ability names", () => {
  it("uses the official keyword name or numbers the card's abilities, never translating English text", () => {
    expect(v2ActivationLabel(equip, [equip])).toBe("[装配]");
    const gold: V2ActivationOption = { sourceObjectId: "gold-1", abilityId: "0", label: "Kill this, Exhaust: Add [A].", reaction: true };
    expect(v2ActivationLabel(gold, [gold])).toBe("能力（反应）");
    const first: V2ActivationOption = { sourceObjectId: "rack-1", abilityId: "0", label: "Pay 1: Draw 1." };
    const second: V2ActivationOption = { sourceObjectId: "rack-1", abilityId: "1", label: "Exhaust: Ready a unit." };
    expect(v2ActivationLabel(first, [first, second])).toBe("能力 1");
    expect(v2ActivationLabel(second, [first, second])).toBe("能力 2");
  });

  it("sends exactly the listed source and ability", () => {
    expect(buildV2ActivateCommand(equip)).toEqual({ type: "activate", sourceObjectId: "sword-1", abilityId: "0" });
    const value = projection([equip]);
    expect(v2ActivationsFor(value, "sword-1")).toEqual([equip]);
    expect([...v2ActivationSourceIds(value)]).toEqual(["sword-1"]);
    // Older projections omit the list: nothing is offered.
    expect([...v2ActivationSourceIds(projection())]).toEqual([]);
  });
});

describe("RIFT-1183 board offers listed abilities", () => {
  it("lists each ability with its card's Chinese name and glows its permanent", () => {
    const { html } = render(projection([equip]));
    const section = activationSection(html);
    expect(section).toContain("可发动");
    expect(section).toContain("长剑 · [装配]");
    expect(section).not.toContain("Equip");
    expect(html).toMatch(/<li class="v2m-stack[^"]*v2-operable[^"]*"[^>]*data-object-id="sword-1"/);
    expect(html).not.toMatch(/<li class="v2m-stack[^"]*v2-operable[^"]*"[^>]*data-object-id="mech-1"/);
  });

  it("offers nothing when the server lists no ability", () => {
    expect(activationSection(render(projection([])).html)).toBe("");
    expect(activationSection(render(projection()).html)).toBe("");
  });

  it("sends activate from the side list", async () => {
    const { onCommand } = render(projection([equip]));
    const button = captured.props.find(props => props.children !== undefined &&
      JSON.stringify(props.children).includes("[装配]") && typeof props.onClick === "function");
    expect(button).toBeDefined();
    (button!.onClick as () => void)();
    await Promise.resolve();
    expect(onCommand).toHaveBeenCalledWith({ type: "activate", sourceObjectId: "sword-1", abilityId: "0" });
  });

  it("opens the ability menu on a plain click of a listed permanent only", () => {
    render(projection([equip]));
    const interaction = captured.props.find(props => typeof (props.interaction as { onObjectClick?: unknown } | undefined)?.onObjectClick === "function")
      ?.interaction as { readonly onObjectClick: (objects: readonly unknown[], multi?: boolean, anchor?: { x: number; y: number }) => boolean };
    expect(interaction).toBeDefined();
    const value = projection([equip]);
    const sword = value.objects.find(object => object.objectId === "sword-1")!;
    const mech = value.objects.find(object => object.objectId === "mech-1")!;
    expect(interaction.onObjectClick([sword], false, { x: 10, y: 20 })).toBe(true);
    // Any other permanent still opens its card as before.
    expect(interaction.onObjectClick([mech], false, { x: 10, y: 20 })).toBe(false);
  });

  it("draws the menu with the card name and official ability names", () => {
    const html = renderToStaticMarkup(<V2ActivationMenu label="长剑" sourceObjectId="sword-1" options={[equip]}
      anchor={{ x: 10, y: 20 }} onActivate={() => undefined} />);
    expect(html).toContain('aria-label="长剑 的可发动能力"');
    expect(html).toContain("发动 [装配]");
  });
});
