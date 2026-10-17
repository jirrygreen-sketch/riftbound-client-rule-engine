import assert from "node:assert/strict";
import test from "node:test";
import { replayJournal } from "../../dist/v2/index.js";
import { VIEWERS, recordGame, replayOptions } from "./support.mjs";

const recorded = recordGame();

for (const viewer of VIEWERS) {
  test(`every ${String(viewer)} snapshot preserves private hand and deck boundaries`, () => {
    const result = replayJournal(recorded.journal, replayOptions(viewer));
    for (const [index, step] of result.steps.entries()) {
      const projection = step.projection;
      assert.equal(projection.schemaVersion, 2);
      assert.equal(projection.viewer, viewer);
      for (const seat of ["A", "B"]) {
        const player = projection.players[seat];
        assert.ok(player.hand.count > 0);
        assert.equal(player.mainDeck.cards.length, 0);
        assert.equal(player.runeDeck.cards.length, 0);
        assert.ok(player.mainDeck.count > 0);
        assert.ok(player.runeDeck.count > 0);
        if (seat === viewer) {
          assert.ok(player.hand.cards.every(card => typeof card.cardId === "string"));
        } else {
          for (const card of player.hand.cards) {
            assert.equal(card.visibility, "face-down");
            assert.match(card.id, /^hidden:/u);
            assert.equal(Object.hasOwn(card, "cardId"), false);
            assert.equal(Object.hasOwn(card, "name"), false);
            assert.equal(Object.hasOwn(card, "energy"), false);
            assert.equal(Object.hasOwn(card, "power"), false);
          }
          const authorityView = recorded.liveSteps[index].projections[seat === "A" ? 0 : 1];
          const serialized = JSON.stringify(step);
          for (const own of authorityView.players[seat].hand.cards) {
            assert.equal(serialized.includes(JSON.stringify(own.ref.id)), false,
              `authoritative hidden reference leaked to ${String(viewer)}`);
          }
        }
      }
    }
    // Raw journals, private receipts, match objects and the other seat's view
    // never accompany the intentionally public summary.
    assert.deepEqual(Object.keys(result).sort(), ["engineMismatch", "engineVersion", "matchId", "recordedEngineVersion", "steps", "summary", "viewer"]);
    assert.deepEqual(result.summary.scores, { A: 0, B: 0 });
    assert.ok(["A", "B"].includes(result.summary.winner));
  });
}

test("hidden hand references stay scoped to the selected replay viewer", () => {
  const a = replayJournal(recorded.journal, replayOptions("A")).steps[0].projection;
  const spectator = replayJournal(recorded.journal, replayOptions("spectator")).steps[0].projection;
  assert.notEqual(a.players.B.hand.cards[0].id, spectator.players.B.hand.cards[0].id);
  assert.equal(a.players.B.hand.count, spectator.players.B.hand.count);
});
