// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-reveal-hand-snapshot-later-draws-private (CR v1.5 425.3.a, 425.3.a.1, 108.7.c)
//   scenario: privacy-reveal-hand-includes-all-current-cards   (CR v1.5 425.3.a)
//
// Subject: effect.reveal over the Hand through the real ChainEngine. The
// ActionOutcome lists exactly the cards that were displayed; the test only
// asserts on that real list (no fixture names the snapshot).
import assert from "node:assert/strict";
import test from "node:test";
import { c, drain, projectFor, projectionState, revealGrant, scene, spellDraft } from "./harness.mjs";

test("privacy-reveal-hand-includes-all-current-cards: an unnumbered reveal displays every card in the zone at that moment", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("h1", { owner: "A", cardId: "card:h1", types: ["unit"] })
    .hand("h2", { owner: "A", cardId: "card:h2", types: ["unit"] })
    .hand("h3", { owner: "A", cardId: "card:h3", types: ["spell"] })
    .hand("spell", { owner: "B", cardId: "card:spell", types: ["spell"] }), { turnPlayer: "B" });

  s.engine.execute({
    id: "b-spell", controller: "B", source: s.kernel.getObject("spell"), kind: "spell", speed: "normal",
    body: [{ id: "rev", op: "effect.reveal", args: { player: c("A"), zone: c("hand") } }],
    cost: { id: "cost:b-spell", cost: { energy: c(0), power: c([]) } }
  });
  drain(s.engine);

  const revealed = s.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").map(event => event.object.ref);
  // The played spell left the hand before resolving, so exactly the three
  // cards that were still there are displayed (425.3.a).
  assert.deepEqual([...revealed.map(ref => ref.id)].sort(), ["h1", "h2", "h3"]);
  assert.deepEqual(s.kernel.zone("A", "hand").map(ref => ref.id).sort(), ["h1", "h2", "h3"], "425.1.a.2: the cards stay in hand");

  const state = { ...projectionState(s.kernel), visibility: [revealGrant(revealed)] };
  for (const viewer of ["A", "B", null]) {
    const projection = projectFor(state, viewer);
    assert.equal(projection.players.A.hand.count, 3);
    assert.deepEqual(projection.players.A.hand.cards.map(card => card.visibility), ["identity", "identity", "identity"], viewer + " sees the reveal window");
  }
});

test("privacy-reveal-hand-snapshot-later-draws-private: cards drawn after the reveal never inherit the reveal state", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("h1", { owner: "A", cardId: "card:h1", types: ["spell"] })
    .hand("draw-spell", { owner: "A", cardId: "card:draw", types: ["spell"] })
    .deck(["d1"], { owner: "A", cardId: "card:d1" }));

  // First spell: reveal A's hand. Only the second spell is still there.
  s.engine.execute(spellDraft(s.kernel, "h1", [{ id: "rev", op: "effect.reveal", args: { player: c("A"), zone: c("hand") } }]));
  drain(s.engine);
  const firstReveal = s.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").map(event => event.object.ref);
  assert.deepEqual(firstReveal.map(ref => ref.id), ["draw-spell"]);

  // Second spell: draw 1 after the reveal window closed.
  s.engine.execute(spellDraft(s.kernel, "draw-spell", [{ id: "draw", op: "effect.draw", args: { amount: c(1) } }]));
  drain(s.engine);
  assert.deepEqual(s.kernel.zone("A", "hand").map(ref => ref.id), ["d1"]);

  // 425.3.a.1: the snapshot only covered the card present at display time.
  const state = projectionState(s.kernel);
  const B = projectFor(state, "B");
  const spectator = projectFor(state, null);
  assert.equal(B.players.A.hand.cards[0].visibility, "face-down", "the later draw is private");
  assert.equal(spectator.players.A.hand.cards[0].visibility, "face-down");
  assert.equal(projectFor(state, "A").players.A.hand.cards[0].cardId, "card:d1");
});

