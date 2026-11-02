import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import { PlayMenu, V2MatchBoard } from "../../src/full-product/v2/V2MatchBoard";
import {
  buildV2HideCommand,
  V2_HIDDEN_LABEL,
  v2HideOptionsFor,
  v2IsOwnHidden
} from "../../src/full-product/v2/hidden";
import { createV2ChoiceUiState, createV2ClientState, type V2ClientState } from "../../src/state/v2";
import type { CatalogCard } from "../../src/net/CardCatalogClient";
import type { V2CommandRequest } from "../../src/transport/v2";
import type { V2HideOption, V2PlayOption, V2ProjectedObject, V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// RIFT-1185: the server lists Hide options and a hidden card's later play; the
// board offers exactly those, sends `hide`, and shows a hidden card's face only
// to its owner (CR 107.3.f, 128.4).
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

// Official zh_CN names (gallery updated 2026-10-28): sfd-070-221 痛苦之酬.
const wagesOfPain = {
  id: "sfd-070-221", name: "Wages of Pain", localizedName: "痛苦之酬", cardType: "Spell", domains: ["Mind"],
  energy: 3, imageUrl: "https://example.test/wages-of-pain.png"
} as unknown as CatalogCard;

const hideOption: V2HideOption = { cardObjectId: "hand-wages", battlefieldId: "bf-1", payable: true };

const ownHidden: V2ProjectedObject = {
  objectId: "hidden-own", zoneEntryId: 4, zone: "facedown", ownerPlayerId: "alice", cardId: "sfd-070-221",
  name: "Wages of Pain", faceDown: true, visibility: "owner-only", location: { kind: "battlefield", battlefieldId: "bf-1" }
};
const opponentHidden: V2ProjectedObject = {
  objectId: "hidden:opaque", zoneEntryId: 3, zone: "facedown", ownerPlayerId: "bob", faceDown: true,
  visibility: "public", location: { kind: "battlefield", battlefieldId: "bf-1" }
};
const playFromHidden: V2PlayOption = {
  cardObjectId: "hidden-own", destination: { kind: "base", playerId: "alice" }, requiresDestination: false
};

function projection({ hides, plays = [], objects = [] }: {
  readonly hides?: readonly V2HideOption[];
  readonly plays?: readonly V2PlayOption[];
  readonly objects?: readonly V2ProjectedObject[];
} = {}): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "rift-1185-hidden",
    viewerPlayerId: "alice",
    stateVersion: 9,
    eventSeq: 3,
    phase: "main",
    turnNumber: 4,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 0, energy: 0, power: {}, xp: 0, handCount: 1, deckCount: 20, runeDeckCount: 8, zoneCounts: {} },
      { playerId: "bob", name: "Bob", score: 0, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 8, zoneCounts: {} }
    ],
    zones: [],
    objects: [
      { objectId: "hand-wages", zoneEntryId: 2, zone: "hand", ownerPlayerId: "alice", cardId: "sfd-070-221",
        name: "Wages of Pain", faceDown: false, visibility: "owner-only" },
      ...objects
    ],
    chain: { status: "open", phase: "await-commit", priorityPlayerId: "alice", focusPlayerId: null, items: [] },
    priority: { playerId: "alice", focusPlayerId: null, window: "main" },
    scoring: {
      victoryScore: 8,
      battlefieldLocationIds: ["bf-1"],
      players: [
        { playerId: "alice", points: 0, controlledBattlefieldIds: ["bf-1"], scoredBattlefieldLocationIds: [] },
        { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
      ]
    },
    battlefields: [{ battlefieldId: "bf-1", controllerPlayerId: "alice", contestedByPlayerId: null, staged: "none", occupantObjectIds: [] }],
    combat: { status: "none" },
    actionOptions: { canEndTurn: true, canAdvance: false, moves: [], plays: [...plays],
      ...(hides === undefined ? {} : { hides }) },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: []
  } as V2Projection;
}

function render(value: V2Projection): string {
  const state: V2ClientState = {
    ...createV2ClientState({ viewerPlayerId: "alice", now: 0, choiceTimeoutMs: 10_000 }),
    connectionStatus: "connected",
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "alice", now: 0, timeoutMs: 10_000 })
  };
  return renderToStaticMarkup(<V2MatchBoard state={state} initialCatalogCards={[wagesOfPain]}
    onCommand={async (_request: V2CommandRequest) => ({
      type: "command-receipt" as const, protocolVersion: "2.0.0", commandId: "test", stateVersion: 10, eventSeq: 4,
      accepted: true, duplicate: false, rejection: null
    })} />);
}

function boardInteraction(): { readonly onObjectClick: (objects: readonly unknown[], multi?: boolean, anchor?: { x: number; y: number }) => boolean } {
  const interaction = captured.props.find(props =>
    typeof (props.interaction as { onObjectClick?: unknown } | undefined)?.onObjectClick === "function")?.interaction;
  if (interaction === undefined) throw new Error("No board interaction was rendered");
  return interaction as ReturnType<typeof boardInteraction>;
}

describe("RIFT-1185 Hidden helpers", () => {
  it("uses the official keyword name and sends exactly the listed card and Battlefield", () => {
    expect(V2_HIDDEN_LABEL).toBe("待命");
    expect(buildV2HideCommand(hideOption)).toEqual({ type: "hide", cardObjectId: "hand-wages", battlefieldId: "bf-1" });
    expect(v2HideOptionsFor(projection({ hides: [hideOption] }), "hand-wages")).toEqual([hideOption]);
    // Older projections omit the list: nothing is offered.
    expect(v2HideOptionsFor(projection(), "hand-wages")).toEqual([]);
    expect(v2IsOwnHidden(ownHidden, "alice")).toBe(true);
    expect(v2IsOwnHidden(opponentHidden, "alice")).toBe(false);
  });
});

describe("RIFT-1185 board offers Hide", () => {
  it("keeps a hand card that can only be hidden operable", () => {
    const html = render(projection({ hides: [hideOption] }));
    expect(html).toMatch(/class="v2-hand-slot v2-operable"/);
    expect(render(projection())).toMatch(/class="v2-hand-slot is-dim"/);
  });

  it("lists each Battlefield and explains an unpaid Hide cost", () => {
    const onHide = vi.fn();
    const card = projection().objects[0]!;
    const html = renderToStaticMarkup(<PlayMenu card={card} plays={[]} label="痛苦之酬" disabled={false}
      anchor={{ x: 10, y: 20 }} destinationLabel={() => "战场一"} onPlay={() => undefined}
      hides={[hideOption, { cardObjectId: "hand-wages", battlefieldId: "bf-2", payable: false }]} onHide={onHide} />);
    expect(html).toContain("待命 · 战场一");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="待命需支付 1 点任意符能：先右键一枚符文回收取符能"/);
    expect(html).toContain("（需 1 点符能）");
    const button = captured.props.find(props => props.role === "menuitem" && props.disabled === false &&
      JSON.stringify(props.children).includes("待命"));
    (button!.onClick as () => void)();
    expect(onHide).toHaveBeenCalledWith(hideOption);
  });

  it("names a facedown play as playing it from Hidden", () => {
    const html = renderToStaticMarkup(<PlayMenu card={ownHidden} plays={[playFromHidden]} label="痛苦之酬" disabled={false}
      anchor={{ x: 10, y: 20 }} destinationLabel={() => "基地"} onPlay={() => undefined} fromHidden />);
    expect(html).toContain("从待命打出");
  });
});

describe("RIFT-1185 hidden cards on the board", () => {
  it("shows the owner its hidden card's face and the opponent only a card back", () => {
    const html = render(projection({ objects: [ownHidden, opponentHidden] }));
    expect(html).toContain("待命 · 仅你可见");
    expect(html).toContain("wages-of-pain.png");
    expect(html).toContain("待命牌");
    expect(html).not.toContain("hidden:opaque\" data-card-id");
  });

  it("opens the play menu only for the viewer's own listed hidden card", () => {
    render(projection({ plays: [playFromHidden], objects: [ownHidden, opponentHidden] }));
    const interaction = boardInteraction();
    expect(interaction.onObjectClick([ownHidden], false, { x: 10, y: 20 })).toBe(true);
    expect(interaction.onObjectClick([opponentHidden], false, { x: 10, y: 20 })).toBe(false);
  });

  it("does not offer a hidden card that the server does not list", () => {
    render(projection({ objects: [ownHidden] }));
    expect(boardInteraction().onObjectClick([ownHidden], false, { x: 10, y: 20 })).toBe(false);
  });
});
