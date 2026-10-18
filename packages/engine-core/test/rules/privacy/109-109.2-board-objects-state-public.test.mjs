// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-board-objects-state-public      (CR v1.5 109, 109.2)
//   scenario: privacy-base-runes-exhaustion-state-public (107.1.d, 109.2)
//
// Subject: src/projection/v2 projectFor. The position comes from the reference
// kernel; exhaustion/damage/buff state is read through its real actions.
import assert from "node:assert/strict";
import test from "node:test";
import { projectFor, world } from "./harness.mjs";

test("privacy-board-objects-state-public: damage, buffs and exhaustion are public on the board", () => {
  const fixture = world()
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .unit("u1", { owner: "A", might: 2, location: { type: "battlefield", id: "bf1" } })
    .base("g1", { owner: "A", types: ["gear"], exhausted: true, location: { type: "base", player: "A" } })
    .build();
  // Real actions create the public state; nothing is hand-settled.
  assert.equal(fixture.perform({ type: "damage", source: fixture.ref("u1"), target: fixture.ref("u1"), amount: 1, combat: false }).status, "done");
  assert.equal(fixture.perform({ type: "buff", object: fixture.ref("u1"), amount: 1 }).status, "done");
  assert.equal(fixture.getObject("u1").damage, 1);
  assert.equal(fixture.getObject("u1").buffs, 1);

  const state = {
    players: [
      { id: "A", ...fixture.player("A"), base: [fixture.getObject("g1")], battlefield: [fixture.getObject("u1")] },
      { id: "B", ...fixture.player("B") }
    ],
    objects: fixture.objects
  };
  for (const viewer of ["A", "B", null, "replay"]) {
    const projection = projectFor(state, viewer);
    const unit = projection.players.A.battlefield.cards.find(card => card.cardId === "card:u1");
    assert.ok(unit, viewer + " sees the battlefield unit");
    assert.equal(unit.damage, 1, viewer + " sees the damage counter");
    assert.equal(unit.buffs, 1, viewer + " sees the Buff counter");
    assert.equal(unit.might, 2, viewer + " sees the Might");
    const gear = projection.players.A.base.cards.find(card => card.cardId === "card:g1");
    assert.equal(gear.exhausted, true, viewer + " sees the exhausted Gear");
  }
});

test("privacy-base-runes-exhaustion-state-public: rune identity and readiness are public in every view", () => {
  const fixture = world()
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .rune(["fury-rune", "calm-rune"], { owner: "A" })
    .build();
  // The Channel phase action really moves the runes to the Base Rune Zone.
  assert.equal(fixture.perform({ type: "channel-rune", player: "A", amount: 2 }).status, "done");
  assert.equal(fixture.perform({ type: "exhaust", object: fixture.ref("calm-rune") }).status, "done");
  assert.equal(fixture.getObject("fury-rune").exhausted, false);
  assert.equal(fixture.getObject("calm-rune").exhausted, true);

  const state = {
    players: [
      { id: "A", ...fixture.player("A"), runeZone: fixture.objectsInZone("A", "rune-zone").map(ref => fixture.object(ref)) },
      { id: "B", ...fixture.player("B") }
    ],
    objects: fixture.objects
  };
  for (const viewer of ["A", "B", null, "replay"]) {
    const runes = projectFor(state, viewer).players.A.runeZone.cards;
    assert.equal(runes.length, 2, viewer + " sees both base runes");
    const felt = runes.find(card => card.cardId === "card:fury-rune");
    const calm = runes.find(card => card.cardId === "card:calm-rune");
    assert.equal(felt.exhausted, false);
    assert.equal(calm.exhausted, true);
  }
});

