// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-negative-replay-view-matches-spectator (CR v1.5 128.3, 128.4, 108.7.c)
//
// Subject: src/projection/v2 projectFor. The engine exposes the replay view as
// the same restricted audience as a spectator, so both must be byte-identical
// and must contain no private or secret information.
import assert from "node:assert/strict";
import test from "node:test";
import { assertNotSerialized, projectFor, projectionState, world } from "./harness.mjs";

test("privacy-negative-replay-view-matches-spectator: the in-progress replay view equals the spectator view", () => {
  const kernel = world()
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("h1", { owner: "A", cardId: "card:h1", name: "A Hand Card", types: ["unit"] })
    .hand("h2", { owner: "B", cardId: "card:h2", name: "B Hand Card", types: ["spell"] })
    .deck(["d1"], { owner: "A", cardId: "card:d1", name: "Deck Card" })
    .base("a1", { owner: "A", cardId: "card:a1", name: "Public Base Card" })
    .build();
  const state = projectionState(kernel);

  const spectator = projectFor(state, null);
  const replay = projectFor(state, "replay");
  // Opaque ids are viewer-scoped by design (README: the token never contains
  // the authoritative id), so compare the information content: every zone
  // must expose the same counts, faces and characteristics.
  assert.deepEqual(normalize(replay), normalize(spectator), "128.3/128.4: replay is the most restricted view");
  assert.equal(replay.players.A.hand.cards[0].visibility, "face-down");
  assert.equal(replay.players.B.hand.cards[0].visibility, "face-down");
  assert.equal(replay.players.A.mainDeck.cards.length, 0);
  assert.equal(replay.players.A.base.cards[0].cardId, "card:a1", "public information is still visible");
  assertNotSerialized(replay, ["card:h1", "card:h2", "card:d1"], "replay view");
});

/** Drop the viewer label and the viewer-scoped opaque ids before comparing. */
function normalize(projection) {
  const strip = value => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== "object") return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "viewer") continue;
      if (key === "id" && typeof child === "string" && child.startsWith("hidden:")) output[key] = "<hidden>";
      else if (key === "ref" && child && typeof child === "object") output[key] = { ...child, id: String(child.id).startsWith("hidden:") ? "<hidden>" : child.id };
      else output[key] = strip(child);
    }
    return output;
  };
  return strip(projection);
}
