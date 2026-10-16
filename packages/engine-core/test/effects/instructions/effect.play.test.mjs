import assert from "node:assert/strict";
import test from "node:test";
import effectPlay from "../../../dist/effects/instructions/effect.play.js";
import { AwaitChoice, runInstruction, world } from "../../../dist/effects/testing/index.js";

const expr = value => ({ kind: "constant", value });

test("plays a selected card and links the actual count", () => {
  const kernel = world().hand("card").build();
  const card = kernel.ref("card");
  const result = runInstruction(effectPlay, { target: "card", player: expr("A") }, {
    world: kernel,
    targets: { card: [card] }
  });

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.played, 1);
  assert.equal(kernel.getObject("card")?.zone, "board");
  assert.equal(kernel.history({ action: "play", player: "A" }), 1);
});

test("a replacement hook makes effect.play negated", () => {
  const kernel = world().hand("card").build();
  kernel.addReplacement(action => action.type === "play" ? "replaced" : null);
  const result = runInstruction(effectPlay, { target: "card" }, {
    world: kernel,
    targets: { card: [kernel.ref("card")] }
  });

  assert.equal(result.result?.status, "negated");
  assert.equal(result.result?.reason, "replaced");
  assert.equal(kernel.getObject("card")?.zone, "hand");
});

test("a stale target reference is ignored after the object leaves its zone", () => {
  const kernel = world().hand("card").build();
  const stale = kernel.ref("card");
  kernel.perform({ type: "discard", object: stale });
  const result = runInstruction(effectPlay, { target: "card" }, {
    world: kernel,
    targets: { card: [stale] }
  });

  assert.deepEqual(result.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.history({ action: "play" }), 0);
});

test("amount zero executes without playing a card", () => {
  const kernel = world().hand("card").build();
  const result = runInstruction(effectPlay, { target: "cards", amount: expr(0) }, {
    world: kernel,
    targets: { cards: [kernel.ref("card")] }
  });

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.played, 0);
  assert.equal(kernel.getObject("card")?.zone, "hand");
});

test("amount above the available objects caps at the actual count", () => {
  const kernel = world().hand("one").hand("two").build();
  const result = runInstruction(effectPlay, { target: "cards", amount: expr(5) }, {
    world: kernel,
    targets: { cards: [kernel.ref("one"), kernel.ref("two")] }
  });

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.played, 2);
  assert.equal(kernel.history({ action: "play" }), 2);
});

test("a non-target play choice suspends without an answer", () => {
  const kernel = world().hand("one").hand("two").build();
  const result = runInstruction(effectPlay, {
    pick: "cards",
    choice: { id: "play-card", min: 1, max: 1 }
  }, {
    world: kernel,
    picks: { cards: [kernel.ref("one"), kernel.ref("two")] }
  });

  assert.ok(result.asked instanceof AwaitChoice);
  assert.equal(kernel.history({ action: "play" }), 0);
});

test("a non-target play choice replays and commits with its answer", () => {
  const kernel = world().hand("one").hand("two").build();
  const one = kernel.ref("one");
  const result = runInstruction(effectPlay, {
    pick: "cards",
    choice: { id: "play-card", min: 1, max: 1 }
  }, {
    world: kernel,
    picks: { cards: [one, kernel.ref("two")] },
    answers: { "play-card": [one] }
  });

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.played, 1);
  assert.equal(kernel.getObject("one")?.zone, "board");
  assert.equal(kernel.getObject("two")?.zone, "hand");
});

test("SFD-203/221 Battle Mistress plays its Gold gear token through the play action", () => {
  const kernel = world().hand("gold-gear-token", { types: ["gear"], cardId: "token.gold-gear" }).build();
  const token = kernel.ref("gold-gear-token");
  const result = runInstruction(effectPlay, {
    target: "gold-gear",
    location: expr({ type: "base", player: "A" }),
    amount: expr(1)
  }, {
    world: kernel,
    targets: { "gold-gear": [token] }
  });

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.played, 1);
  assert.deepEqual(kernel.getObject("gold-gear-token")?.location, { type: "base", player: "A" });
});

test("RAD-116/167 Concert Poster plays its Recruit token to the controller's base with a finalized cost", () => {
  const kernel = world().player("A", { energy: 1 }).hand("recruit-token", { cardId: "token.recruit" }).build();
  const token = kernel.ref("recruit-token");
  const result = runInstruction(effectPlay, {
    target: "recruit",
    location: expr({ type: "base", player: "A" }),
    cost: expr({ finalized: true, energy: 1 })
  }, {
    world: kernel,
    targets: { recruit: [token] }
  });

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.played, 1);
  assert.deepEqual(kernel.getObject("recruit-token")?.location, { type: "base", player: "A" });
  assert.equal(kernel.player("A").energy, 0);
});

test("SFD-026a/221 Rumble, Hotheaded plays a Mech from the trash after cost reduction", () => {
  const kernel = world().card("mech", { cardId: "sfd-021-221", zone: "trash" }).build();
  const mech = kernel.ref("mech");
  const result = runInstruction(effectPlay, {
    target: "mech-from-trash",
    cost: expr({ finalized: true, energy: 0 })
  }, {
    world: kernel,
    targets: { "mech-from-trash": [mech] }
  });

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.played, 1);
  assert.equal(kernel.getObject("mech")?.zone, "board");
});

test("SFD-093/221 Dauntless Vanguard may play to an occupied enemy battlefield", () => {
  const kernel = world().hand("vanguard", { cardId: "sfd-093-221" }).build();
  const vanguard = kernel.ref("vanguard");
  const result = runInstruction(effectPlay, {
    target: "enemy-battlefield-play",
    location: expr({ type: "battlefield", id: "enemy-battlefield" })
  }, {
    world: kernel,
    targets: { "enemy-battlefield-play": [vanguard] }
  });

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.played, 1);
  assert.deepEqual(kernel.getObject("vanguard")?.location, {
    type: "battlefield",
    id: "enemy-battlefield"
  });
});
