import assert from "node:assert/strict";
import test from "node:test";

import { cardProgramsById } from "../../../../../card-dsl/dist/cards/registry.generated.js";
import { defineTemplateSuite } from "../../../../dist/effects/testing/scenario/index.js";

const program = id => {
  const value = cardProgramsById.get(id);
  assert.ok(value, `generated card program ${id} is present`);
  assert.equal(value.status, "executable", `${id} is executable`);
  return value;
};

const rows = [
  {
    name: "Hextech Ray · spell damage at a battlefield",
    canonicalCardId: "card.hash-40b28488632a7824775d37e8c9c7c546f5595145c0f115e8367f9ce7f8a9773d",
    program: program("card.hash-40b28488632a7824775d37e8c9c7c546f5595145c0f115e8367f9ce7f8a9773d"),
    scenario: {
      players: { A: { energy: 10, power: ["Fury"] } },
      objects: [
        { id: "ray", cardId: "card.hash-40b28488632a7824775d37e8c9c7c546f5595145c0f115e8367f9ce7f8a9773d", types: ["spell"], zone: "hand", energy: 1, power: ["Fury"] },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: { type: "battlefield", id: "battlefield-1" }, might: 5 },
      ],
      operations: [
        { type: "play", object: "ray", player: "A" },
        { type: "choose", id: "target:hextech-ray.unit-at-battlefield", value: ["enemy"] },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: { ray: { zone: "trash" }, enemy: { damage: 3 } },
        events: { includes: [{ timingPoint: "damage-dealt" }, { timingPoint: "card-played" }] },
      },
    },
  },
  {
    name: "Cloud Drake · play trigger draws",
    canonicalCardId: "card.hash-31bab80a3ed5d98ccd6492ffb83f0c7d0192f5fdd9a176cd38334395723cf7fc",
    program: program("card.hash-31bab80a3ed5d98ccd6492ffb83f0c7d0192f5fdd9a176cd38334395723cf7fc"),
    scenario: {
      objects: [
        { id: "drake", cardId: "card.hash-31bab80a3ed5d98ccd6492ffb83f0c7d0192f5fdd9a176cd38334395723cf7fc", types: ["unit"], zone: "hand", might: 2 },
        { id: "top", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "drake", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: { objects: { drake: { zone: "board" }, top: { zone: "hand" } }, events: { includes: [{ timingPoint: "card-drawn" }] } },
    },
  },
  {
    name: "Heart of Dark Ice · activated ability",
    canonicalCardId: "card.hash-fb2b68d85d71603dc36df01e06a5cedb3afd2385f4545e34f533a975f5db9ffa",
    program: program("card.hash-fb2b68d85d71603dc36df01e06a5cedb3afd2385f4545e34f533a975f5db9ffa"),
    scenario: {
      objects: [
        { id: "source", cardId: "card.hash-fb2b68d85d71603dc36df01e06a5cedb3afd2385f4545e34f533a975f5db9ffa", types: ["unit"], zone: "board", location: { type: "battlefield", id: "battlefield-1" }, might: 2 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "battlefield-1" }, might: 2 },
      ],
      answers: { "target:heart-of-dark-ice.unit": ["ally"] },
      operations: [
        { type: "activate", object: "source", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: { objects: { source: { exhausted: true }, ally: { might: 5 } } },
    },
  },
  {
    name: "Your units have Might · static aura",
    canonicalCardId: "card.hash-9ec6311582c4337e549c7a39070aeaf28ae3996142538fa2fb11c3b16cebcf5b",
    program: program("card.hash-9ec6311582c4337e549c7a39070aeaf28ae3996142538fa2fb11c3b16cebcf5b"),
    scenario: {
      objects: [
        { id: "aura", cardId: "card.hash-9ec6311582c4337e549c7a39070aeaf28ae3996142538fa2fb11c3b16cebcf5b", types: ["unit"], zone: "board", location: { type: "battlefield", id: "battlefield-1" }, might: 2 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "battlefield-1" }, might: 2 },
      ],
      expect: { objects: { aura: { might: 4 }, ally: { might: 4 } } },
    },
  },
  {
    name: "I enter ready · replacement",
    canonicalCardId: "card.hash-b6830324541a4a0e8a3b92c94688fa14073792584686e1c85aab70bbb747ff4a",
    program: program("card.hash-b6830324541a4a0e8a3b92c94688fa14073792584686e1c85aab70bbb747ff4a"),
    scenario: {
      objects: [{ id: "unit", cardId: "card.hash-b6830324541a4a0e8a3b92c94688fa14073792584686e1c85aab70bbb747ff4a", types: ["unit"], zone: "hand", might: 2 }],
      operations: [{ type: "play", object: "unit", player: "A" }],
      expect: { objects: { unit: { zone: "board", exhausted: false } }, events: { includes: [{ timingPoint: "object-enters-board" }] } },
    },
  },
  {
    name: "Eclipse · target plus ordered pick",
    canonicalCardId: "card.hash-de24e677d5541604808bbe583f958d702c8e2067e5a554af3d856ceac17c6354",
    program: program("card.hash-de24e677d5541604808bbe583f958d702c8e2067e5a554af3d856ceac17c6354"),
    scenario: {
      players: { A: { energy: 10 } },
      objects: [
        { id: "spell", cardId: "card.hash-de24e677d5541604808bbe583f958d702c8e2067e5a554af3d856ceac17c6354", types: ["spell"], zone: "hand", energy: 3, power: [] },
        { id: "ally", types: ["unit"], zone: "board", location: { type: "battlefield", id: "battlefield-1" }, might: 5 },
        { id: "top", owner: "A", types: ["unit"], zone: "deck" },
      ],
      answers: { "eclipse.chosen-unit": ["ally"], "eclipse.predict": [] },
      operations: [
        { type: "play", object: "spell", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: { objects: { ally: { might: 1 }, top: { zone: "deck" } }, events: { includes: [{ timingPoint: "cards-looked-at" }] } },
    },
  },
  {
    name: "Salvage · optional choice and target",
    canonicalCardId: "card.hash-75f34b26c92bf9cba4a9ba616b2a7988ef08395e860ed8c5269f15ea0ac6a850",
    program: program("card.hash-75f34b26c92bf9cba4a9ba616b2a7988ef08395e860ed8c5269f15ea0ac6a850"),
    scenario: {
      objects: [
        { id: "spell", cardId: "card.hash-75f34b26c92bf9cba4a9ba616b2a7988ef08395e860ed8c5269f15ea0ac6a850", types: ["spell"], zone: "hand", energy: 0, power: [] },
        { id: "gear", owner: "B", types: ["gear"], zone: "board", location: { type: "battlefield", id: "battlefield-1" }, might: 0 },
        { id: "top", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "spell", player: "A" },
        { type: "choose", id: "optional", value: true },
        { type: "choose", id: "target:salvage-gear", value: ["gear"] },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: { objects: { gear: { zone: "trash" }, top: { zone: "hand" } } },
    },
  },
  {
    name: "Premonition · reaction draw",
    canonicalCardId: "card.hash-281e4f29c74b8ba799276e97df9e961d0366cf7c8b6fd6c90bb383574d9f40c5",
    program: program("card.hash-281e4f29c74b8ba799276e97df9e961d0366cf7c8b6fd6c90bb383574d9f40c5"),
    scenario: {
      players: { A: { energy: 10, power: ["Fury", "Fury", "Fury"] } },
      objects: [
        { id: "reaction", cardId: "card.hash-281e4f29c74b8ba799276e97df9e961d0366cf7c8b6fd6c90bb383574d9f40c5", types: ["spell"], zone: "hand", energy: 2, power: ["Fury"] },
        { id: "top-1", owner: "A", types: ["unit"], zone: "deck" },
        { id: "top-2", owner: "A", types: ["unit"], zone: "deck" },
        { id: "top-3", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: [
        { type: "play", object: "reaction", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: { players: { A: { handSize: 3 } }, events: { includes: [{ timingPoint: "card-drawn" }] } },
    },
  },
];

for (const row of defineTemplateSuite("scenario harness", rows)) test(row.name, row.run);
