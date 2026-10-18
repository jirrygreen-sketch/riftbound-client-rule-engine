// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-runedeck-top-channel-reveals-on-board-only (CR v1.5 108.5.d, 431.2, 107.1.d)
//
// Subject: effect.channel through the real ChainEngine plus src/projection/v2.
// The Rune Deck is Secret before and after; the channeled rune becomes a
// public Board object.
import assert from "node:assert/strict";
import test from "node:test";
import { c, drain, projectFor, projectionState, scene, spellDraft } from "./harness.mjs";

test("privacy-runedeck-top-channel-reveals-on-board-only: the Rune Deck stays count-only while the channeled rune is public", () => {
  const s = scene(w => w
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .rune(["r1", "r2"], { owner: "A", cardId: "card:r1" })
    .hand("spell", { owner: "A", types: ["spell"] }));

  const before = projectionState(s.kernel);
  for (const viewer of ["A", "B", null, "replay"]) {
    const runeDeck = projectFor(before, viewer).players.A.runeDeck;
    assert.equal(runeDeck.count, 2, viewer + " sees the rune deck count");
    assert.equal(runeDeck.cards.length, 0, viewer + " sees no rune deck order");
  }

  s.engine.execute(spellDraft(s.kernel, "spell", [{ id: "ch", op: "effect.channel", args: { amount: c(1) } }]));
  drain(s.engine);
  // The real Channel action moved the top rune to the Base Rune Zone.
  assert.deepEqual(s.kernel.zone("A", "rune-deck").map(ref => ref.id), ["r2"]);
  assert.deepEqual(s.kernel.zone("A", "rune-zone").map(ref => ref.id), ["r1"]);

  const after = projectionState(s.kernel);
  for (const viewer of ["A", "B", null, "replay"]) {
    const projection = projectFor(after, viewer);
    assert.equal(projection.players.A.runeDeck.count, 1, viewer + " sees the new rune deck count");
    assert.equal(projection.players.A.runeDeck.cards.length, 0, viewer + " still sees no rune deck order");
    assert.equal(projection.players.A.runeZone.count, 1, viewer + " sees the base rune");
    assert.equal(projection.players.A.runeZone.cards[0].cardId, "card:r1", viewer + " reads the on-board rune");
  }
});

