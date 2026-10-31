import assert from "node:assert/strict";
import test from "node:test";
import { runCardScenario } from "../../dist/effects/testing/scenario/index.js";

// Official evidence (Core Rules v1.5, published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 143.4 (Units enter exhausted), 383.4.a.2 (a Play Effect becomes Pending
// after the permanent enters Board), 401-403.2 (the Triggered Ability is then
// finalized and its required target choice is made), 355.7 and 406.1 (that
// choice is a Target and must remain legal through finalization), and
// 416.1.b/416.1.c (Ready changes only an exhausted object).
// canonicalCardId: card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389.
// This focused fixture uses the registered card body but the generic scenario
// engine; it does not alter card status or inject an engine-only ready path.
const BUBBLE_BOT = "card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389";
const { default: bubbleBot } = await import("../../../card-dsl/dist/cards/sfd/bubble-bot.js");

const BASE_A = { type: "base", player: "A" };
const bubble = {
  id: "bubble",
  cardId: BUBBLE_BOT,
  program: bubbleBot,
  types: ["unit"],
  tags: ["Mech", "Yordle", "Bandle City"],
  zone: "hand",
  energy: 3,
  power: [],
  might: 3
};
const play = [
  { type: "play", object: "bubble", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" }
];

function object(result, id) {
  return result.state.objects.find(candidate => candidate.ref.id === id);
}

test("RIFT-1172 Bubble Bot readies the chosen other friendly Mech through play, Finalize and Resolve", () => {
  const result = runCardScenario(bubbleBot, {
    players: { A: { energy: 3 } },
    answers: { "target:other-friendly-mech": ["rumble"] },
    objects: [
      bubble,
      { id: "rumble", owner: "A", types: ["unit"], tags: ["Mech"], zone: "board", location: BASE_A, might: 4, exhausted: true },
      { id: "second-mech", owner: "A", types: ["unit"], tags: ["Mech"], zone: "board", location: BASE_A, might: 2, exhausted: true },
      { id: "enemy-mech", owner: "B", controller: "B", types: ["unit"], tags: ["Mech"], zone: "board", location: { type: "base", player: "B" }, might: 2, exhausted: true }
    ],
    operations: play
  });
  assert.equal(object(result, "rumble").exhausted, false);
  assert.equal(object(result, "second-mech").exhausted, true);
  assert.equal(object(result, "bubble").exhausted, true);
  assert.equal(object(result, "enemy-mech").exhausted, true);
  assert.deepEqual(result.events.filter(event => event.timingPoint === "object-readied").map(event => event.object?.ref.id), ["rumble"]);
  assert.deepEqual(result.state.chain, []);
});

test("RIFT-1172 Bubble Bot has no choice when its own exhausted incarnation is the only friendly Mech", () => {
  const result = runCardScenario(bubbleBot, {
    players: { A: { energy: 3 } },
    objects: [
      bubble,
      { id: "non-mech", owner: "A", types: ["unit"], tags: ["Poro"], zone: "board", location: BASE_A, might: 2, exhausted: true }
    ],
    operations: [{ type: "play", object: "bubble", player: "A" }]
  });
  assert.equal(object(result, "bubble").zone, "board");
  assert.equal(object(result, "bubble").exhausted, true);
  assert.equal(object(result, "non-mech").exhausted, true);
  assert.equal(result.events.some(event => event.timingPoint === "object-readied"), false);
  assert.deepEqual(result.state.chain, []);
});
