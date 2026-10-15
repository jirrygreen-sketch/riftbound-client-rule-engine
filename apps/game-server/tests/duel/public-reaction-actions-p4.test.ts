import { describe, expect, it } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, type DuelCommandMessageV3Actions1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createAuthoritativeDuelRuntimeP4 } from "../../src/duel/authoritative-runtime-p4.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";

// Controlled fixture. `REACTION_TEXT` mirrors the verified Premonition-shaped
// Reaction/Draw 3 source so the real Core response window accepts it; the
// non-reaction printing keeps an ordinary "Draw 4." program. These are NOT the
// official printing prices/texts and this is NOT official catalog coverage.
// Only deck entry ORDER is changed (never counts), so the genuine constructor
// still runs its own Domain Identity/copy/zone validation and shuffle.
const REACTION_TEXT = "[Reaction] (Play any time, even before spells and abilities resolve.)\nDraw 3.";
const REACTION_SPELL_ID = "ogn-004-298";
const NON_REACTION_SPELL_ID = "ogn-005-298";

type Runtime = ReturnType<typeof createAuthoritativeDuelRuntimeP4>;
type PacketBody = DuelCommandMessageV3Actions1["command"];
type Deck = typeof setupAdapterFixtureDecks.a.submission;

/** Legal reordering only: front-loads the given cardIds, keeps every count. */
function frontLoad(sub: Deck, order: readonly string[]): Deck {
  const rest = [...sub.mainDeck];
  const head: Deck["mainDeck"] = [];
  for (const cardId of order) {
    const index = rest.findIndex(entry => entry.cardId === cardId);
    if (index >= 0) head.push(rest.splice(index, 1)[0]!);
  }
  return { ...sub, mainDeck: [...head, ...rest] };
}

function packet(runtime: Runtime, actor: string, commandId: string, command: PacketBody): DuelCommandMessageV3Actions1 {
  return { type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: `${commandId}:request`, commandId, expectedVersion: runtime.project(actor).match.stateVersion, command };
}
const dispatch = (runtime: Runtime, actor: string, commandId: string, command: PacketBody) =>
  runtime.dispatch(actor, packet(runtime, actor, commandId, command));

async function fixture(matchId: string): Promise<Runtime> {
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === "Unit" ? "" : card.cardType === "Spell"
      ? (card.id === REACTION_SPELL_ID ? REACTION_TEXT : "Draw 4.") : card.ability,
    ...(card.cardType === "Spell" ? { energy: 1 } : {}) }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: "2026-10-12-official-gallery",
    digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" } });
  let uid = 0;
  const deck = (sub: Deck) => frontLoad(sub, [REACTION_SPELL_ID, NON_REACTION_SPELL_ID, "ogn-001-298"]);
  return createAuthoritativeDuelRuntimeP4({ catalog, matchId,
    roster: [
      { playerId: "alice", displayName: "Alice", deck: deck(setupAdapterFixtureDecks.a.submission) },
      { playerId: "bob", displayName: "Bob", deck: deck(setupAdapterFixtureDecks.b.submission) },
    ], randomIndex: () => 0, uidFactory: () => `p4-reaction-actions-${++uid}` });
}
function mulligans(runtime: Runtime) {
  for (const id of ["reaction-m-1", "reaction-m-2"]) {
    const setup = runtime.project(null).match;
    if (setup.stage !== "setup") throw new Error("setup expected");
    const actor = setup.setup.currentMulliganOwner!;
    expect(dispatch(runtime, actor, id, { type: "mulligan", selectedUIDs: [] }).ack.ok).toBe(true);
  }
}
function hand(runtime: Runtime, playerId: string) {
  const view = runtime.project(playerId);
  if (view.match.stage !== "playing") throw new Error("playing expected");
  return view.match.players.find(player => player.playerId === playerId)?.hand ?? [];
}
function counts(runtime: Runtime) {
  const view = runtime.project(null);
  if (view.match.stage !== "playing") throw new Error("playing expected");
  return Object.fromEntries(view.match.players.map(player => [player.playerId, {
    hand: player.handCount, mainDeck: player.mainDeckCount, trash: player.trash.length }]));
}
function paySpell(runtime: Runtime, actor: string, tag: string) {
  let view = runtime.project(actor);
  const rune = view.actions.find(action => action.kind === "rune-energy" && action.enabled);
  if (!rune || rune.kind !== "rune-energy") throw new Error(`${tag} rune missing: ${JSON.stringify(view.actions)}`);
  const runeResult = dispatch(runtime, actor, `${tag}-rune`, { type: "rune-energy", uid: rune.uid });
  if (!runeResult.ack.ok && !runeResult.ack.pending) throw new Error(`${tag} rune failed: ${JSON.stringify(runeResult.ack)}`);
  view = runtime.project(actor);
  const pay = view.actions.find(action => action.kind === "pay-pending" && action.enabled);
  if (!pay || pay.kind !== "pay-pending") throw new Error(`${tag} pay-pending missing: ${JSON.stringify(view.actions)}`);
  const paid = dispatch(runtime, actor, `${tag}-pay`, { type: "pay-pending", paymentId: pay.paymentId });
  if (!paid.ack.ok) throw new Error(`${tag} payment failed: ${JSON.stringify(paid.ack)}`);
}
function pass(runtime: Runtime, actor: string, tag: string) {
  const view = runtime.project(actor);
  const action = view.actions.find(value => value.kind === "pass-priority");
  if (!action || action.kind !== "pass-priority") throw new Error(`${tag} pass missing: ${JSON.stringify(view.actions)}`);
  const result = dispatch(runtime, actor, tag, { type: "pass-priority", windowId: action.windowId });
  if (!result.ack.ok) throw new Error(`${tag} pass failed: ${JSON.stringify(result.ack)}`);
}

describe("P4 public Reaction action projection", () => {
  it("exposes a real second Reaction Spell in the response window and resolves the genuine LIFO Chain", async () => {
    const runtime = await fixture("p4-public-reaction-actions-lifo");
    mulligans(runtime);

    // Deterministic front-loaded order reaches the first Main on turn 1 with both
    // players holding a reaction Draw 3 Spell. Only ONE earlier turn is needed so
    // the responding opponent has channeled runes to pay the Reaction.
    const start = runtime.project("alice");
    if (start.match.stage !== "playing") throw new Error("playing expected");
    expect(start.match.frame.turnNumber).toBe(1);
    expect(start.match.frame.turnPlayerId).toBe("alice");
    const endTurn = start.actions.find(action => action.kind === "end-turn" && action.enabled);
    if (!endTurn || endTurn.kind !== "end-turn") throw new Error("Alice end-turn missing");
    expect(dispatch(runtime, "alice", "pre-turn-end", { type: "end-turn", windowId: endTurn.windowId }).ack.ok).toBe(true);
    const bobTurn = runtime.project("bob");
    if (bobTurn.match.stage !== "playing") throw new Error("playing expected on Bob's turn");
    expect(bobTurn.match.frame.turnNumber).toBe(2);
    expect(bobTurn.match.frame.turnPlayerId).toBe("bob");
    expect(bobTurn.match.frame.priorityPlayerId).toBe("bob");

    const bobSpell = bobTurn.actions.find(action =>
      action.kind === "play-card" && action.label === "施放法术" && action.enabled);
    if (!bobSpell || bobSpell.kind !== "play-card") throw new Error("Bob first Spell action missing");
    expect(dispatch(runtime, "bob", "first-spell",
      { type: "play-card", cardUID: bobSpell.cardUID, windowId: bobSpell.windowId }).ack.pending).toBe(true);
    paySpell(runtime, "bob", "first");
    pass(runtime, "bob", "response-open-pass-bob");

    // Response window reached: Alice holds the priority, sees no pending payment,
    // and the projection now lists an ENABLED reaction play-card (the gap this
    // change closes). The second Spell is dispatched from that projected action.
    const aliceWindow = runtime.project("alice");
    if (aliceWindow.match.stage !== "playing") throw new Error("playing expected at response window");
    expect(aliceWindow.match.frame.stateOpen).toBe(false);
    expect(aliceWindow.match.frame.priorityPlayerId).toBe("alice");
    expect(aliceWindow.match.frame.chain.active).toBe(true);
    expect(aliceWindow.match.frame.pendingPayment).toBe(null);
    const aliceSpell = aliceWindow.actions.find(action =>
      action.kind === "play-card" && action.label === "施放法术" && action.enabled);
    if (!aliceSpell || aliceSpell.kind !== "play-card") throw new Error(`Alice reaction play-card missing: ${JSON.stringify(aliceWindow.actions)}`);
    const alicePassAction = aliceWindow.actions.find(action => action.kind === "pass-priority");
    if (!alicePassAction || alicePassAction.kind !== "pass-priority") throw new Error("Alice priority pass missing");
    // The Reaction play-card rides the same current response window as the pass.
    expect(aliceSpell.windowId).toBe(alicePassAction.windowId);
    expect(aliceWindow.actions.some(action => action.kind === "play-card" && action.label === "打出单位")).toBe(false);

    const second = dispatch(runtime, "alice", "second-spell",
      { type: "play-card", cardUID: aliceSpell.cardUID, windowId: aliceSpell.windowId });
    expect(second.ack.pending).toBe(true);
    paySpell(runtime, "alice", "second");
    // Baseline AFTER paying (the response Spell has already left Alice's hand):
    // resolution therefore adds exactly 3 drawn cards, 1 trashed Spell.
    const beforeResponse = counts(runtime);
    pass(runtime, "alice", "response-pass-alice");
    pass(runtime, "bob", "response-pass-bob");

    // Alice's response item resolves first (LIFO): her Draw 3 Spell.
    const afterResponse = counts(runtime) as Record<string, { hand: number; mainDeck: number; trash: number }>;
    const before = beforeResponse as Record<string, { hand: number; mainDeck: number; trash: number }>;
    expect(afterResponse.alice!.hand - before.alice!.hand).toBe(3);
    expect(afterResponse.alice!.mainDeck - before.alice!.mainDeck).toBe(-3);
    expect(afterResponse.alice!.trash - before.alice!.trash).toBe(1);

    // The outer Chain survived and Bob's Spell resolves next.
    const mid = runtime.project(null);
    if (mid.match.stage !== "playing") throw new Error("playing expected after response resolution");
    expect(mid.match.frame.chain.active).toBe(true);
    pass(runtime, "bob", "outer-pass-bob");
    pass(runtime, "alice", "outer-pass-alice");

    const final = counts(runtime) as Record<string, { hand: number; mainDeck: number; trash: number }>;
    expect(final.bob!.hand - afterResponse.bob!.hand).toBe(3);
    expect(final.bob!.mainDeck - afterResponse.bob!.mainDeck).toBe(-3);
    expect(final.bob!.trash - afterResponse.bob!.trash).toBe(1);
    const resolved = runtime.project(null);
    if (resolved.match.stage !== "playing") throw new Error("playing expected at settle");
    expect(resolved.match.frame.chain.active).toBe(false);
    for (const player of resolved.match.players)
      expect(player.trash.some(card => card.uid === aliceSpell.cardUID || card.uid === bobSpell.cardUID)).toBe(true);
  }, 60_000);

  it("does not open the response-window action to units, non-Reaction Draw, non-priority, or spectators", async () => {
    const runtime = await fixture("p4-public-reaction-actions-gates");
    mulligans(runtime);

    const aliceSpell = runtime.project("alice").actions.find(action =>
      action.kind === "play-card" && action.label === "施放法术" && action.enabled);
    if (!aliceSpell || aliceSpell.kind !== "play-card") throw new Error("Alice first Spell action missing");
    expect(dispatch(runtime, "alice", "gate-first-spell",
      { type: "play-card", cardUID: aliceSpell.cardUID, windowId: aliceSpell.windowId }).ack.pending).toBe(true);
    paySpell(runtime, "alice", "gate");
    pass(runtime, "alice", "gate-open-pass-alice");

    // Bob is the priority holder in the response window.
    const bobWindow = runtime.project("bob");
    if (bobWindow.match.stage !== "playing") throw new Error("playing expected");
    expect(bobWindow.match.frame.priorityPlayerId).toBe("bob");

    // Only the genuine Reaction Draw Spell is offered; no Unit play, and the
    // non-Reaction "Draw 4." printing held by Bob is NOT opened as a reaction.
    const alphaSpells = bobWindow.actions.filter(action => action.kind === "play-card");
    expect(alphaSpells.every(action => action.kind === "play-card" && action.label === "施放法术")).toBe(true);
    expect(bobWindow.actions.some(action => action.kind === "play-card" && action.label === "打出单位")).toBe(false);
    const bobReaction = hand(runtime, "bob").filter(card => card.cardId === REACTION_SPELL_ID);
    const exposedUIDs = new Set(bobWindow.actions.filter(action => action.kind === "play-card")
      .map(action => (action as { cardUID: string }).cardUID));
    expect(bobReaction.every(card => exposedUIDs.has(card.uid))).toBe(true);
    const bobNonReaction = hand(runtime, "bob").filter(card => card.cardId === NON_REACTION_SPELL_ID);
    expect(bobNonReaction.some(card => exposedUIDs.has(card.uid))).toBe(false);

    // The turn player (Alice) holds no priority here, so she sees no response action.
    const aliceWindow = runtime.project("alice");
    expect(aliceWindow.actions).toEqual([]);
    // A spectator never receives private hand or an action list.
    const spectator = runtime.project(null);
    expect(spectator.actions).toEqual([]);
    expect(JSON.stringify(spectator)).not.toContain(bobReaction[0]!.uid);
  }, 60_000);
});
