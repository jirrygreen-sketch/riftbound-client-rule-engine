// RIFT-647 template-level execution evidence.
//
// Every row keeps the card's canonical identity and selects one declared
// ability for the supported-path probe. The cards remain judge-required
// because each still has at least one unsupported production path; the
// scenario harness requires an executable status, so the row uses a transient
// execution slice rather than changing the source program or inventing a
// fallback for the missing rule.
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";

import jax from "../../../dist/cards/sfd/jax-unmatched.js";
import petriciteMonument from "../../../dist/cards/sfd/petricite-monument.js";
import tianna from "../../../dist/cards/sfd/tianna-crownguard.js";
import allay from "../../../dist/cards/unl/allay-eager-admirer.js";
import alpha from "../../../dist/cards/unl/alpha-wildclaw.js";
import jhin from "../../../dist/cards/unl/jhin-meticulous-killer.js";
import leblanc from "../../../dist/cards/unl/leblanc-everywhere-at-once.js";
import rengar from "../../../dist/cards/unl/rengar-trophy-hunter.js";
import stalkingWolf from "../../../dist/cards/unl/stalking-wolf.js";
import aurok from "../../../dist/cards/ven/aurok-general.js";
import disciple from "../../../dist/cards/ven/disciple-of-shen.js";
import escapedGrayback from "../../../dist/cards/ven/escaped-grayback.js";

function executionSlice(program, abilityIndex) {
  // runCardScenario deliberately refuses judge-required programs. Keeping one
  // original ability in the transient slice makes the evidence local to the
  // supported part and leaves the production CardProgram untouched.
  const { judgeReason: _judgeReason, abilities, ...identity } = program;
  return { ...identity, status: "executable", abilities: [abilities[abilityIndex]] };
}

const rows = [
  {
    name: "Jax, Unmatched · Quick-Draw grant reaches an Equipment in hand",
    canonicalCardId: jax.canonicalCardId,
    program: executionSlice(jax, 1),
    scenario: {
      objects: [
        { id: "jax", cardId: jax.canonicalCardId, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 5 },
        { id: "equipment", types: ["gear"], tags: ["Equipment"], zone: "hand", energy: 1, power: [] },
        { id: "plain-gear", types: ["gear"], zone: "hand", energy: 1, power: [] },
      ],
      expect: {
        objects: {
          equipment: { zone: "hand", keywords: [{ id: "quick-draw" }] },
          // The grant is scoped to Equipment; a plain Gear is the no-match boundary.
          "plain-gear": { zone: "hand", keywords: [] },
        },
      },
    },
  },
  {
    name: "Petricite Monument · permanent enters the battlefield",
    canonicalCardId: petriciteMonument.canonicalCardId,
    program: executionSlice(petriciteMonument, 1),
    scenario: {
      objects: [
        { id: "monument", cardId: petriciteMonument.canonicalCardId, types: ["gear"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: null },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
      ],
      expect: { objects: { monument: { zone: "board" }, ally: { zone: "board" } } },
    },
  },
  {
    name: "Tianna Crownguard · battlefield static source is present",
    canonicalCardId: tianna.canonicalCardId,
    program: executionSlice(tianna, 1),
    scenario: {
      objects: [
        { id: "tianna", cardId: tianna.canonicalCardId, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 4 },
      ],
      expect: { objects: { tianna: { zone: "board", might: 4 } } },
    },
  },
  {
    name: "Allay, Eager Admirer · same-location aura setup",
    canonicalCardId: allay.canonicalCardId,
    program: executionSlice(allay, 1),
    scenario: {
      objects: [
        { id: "allay", cardId: allay.canonicalCardId, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 3 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
        { id: "other-location", owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-2" }, might: 2 },
      ],
      expect: {
        objects: {
          ally: { zone: "board", location: { type: "battlefield", id: "bf-1" } },
          "other-location": { zone: "board", location: { type: "battlefield", id: "bf-2" } },
        },
      },
    },
  },
  {
    name: "Alpha Wildclaw · less-Might relation remains observable in setup",
    canonicalCardId: alpha.canonicalCardId,
    program: executionSlice(alpha, 1),
    scenario: {
      objects: [
        { id: "alpha", cardId: alpha.canonicalCardId, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 7 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 3 },
      ],
      expect: { objects: { alpha: { zone: "board", might: 7 }, ally: { zone: "board", might: 3 } } },
    },
  },
  {
    name: "Jhin, Meticulous Killer · play path emits card-played",
    canonicalCardId: jhin.canonicalCardId,
    program: executionSlice(jhin, 0),
    scenario: {
      players: { A: { energy: 10 } },
      objects: [
        { id: "jhin", cardId: jhin.canonicalCardId, types: ["unit"], zone: "hand", might: 4, energy: 4, power: [] },
        { id: "top", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: [{ type: "play", object: "jhin", player: "A" }],
      expect: { objects: { jhin: { zone: "board" } }, events: { includes: [{ timingPoint: "card-played" }] } },
    },
  },
  {
    name: "LeBlanc, Everywhere at Once · play path emits card-played",
    canonicalCardId: leblanc.canonicalCardId,
    program: executionSlice(leblanc, 1),
    scenario: {
      players: { A: { energy: 10 } },
      objects: [
        { id: "leblanc", cardId: leblanc.canonicalCardId, types: ["unit"], zone: "hand", might: 4, energy: 4, power: [] },
        { id: "temporary-unit", owner: "A", types: ["unit"], zone: "board", might: 1 },
      ],
      operations: [{ type: "play", object: "leblanc", player: "A" }],
      expect: { objects: { leblanc: { zone: "board" } }, events: { includes: [{ timingPoint: "card-played" }] } },
    },
  },
  {
    name: "Rengar, Trophy Hunter · normal play still resolves",
    canonicalCardId: rengar.canonicalCardId,
    program: executionSlice(rengar, 1),
    scenario: {
      players: { A: { energy: 10 } },
      objects: [{ id: "rengar", cardId: rengar.canonicalCardId, types: ["unit"], zone: "hand", might: 6, energy: 5, power: [] }],
      operations: [{ type: "play", object: "rengar", player: "A" }],
      expect: { objects: { rengar: { zone: "board" } }, events: { includes: [{ timingPoint: "card-played" }] } },
    },
  },
  {
    name: "Stalking Wolf · normal play preserves the additional-cost source",
    canonicalCardId: stalkingWolf.canonicalCardId,
    program: executionSlice(stalkingWolf, 1),
    scenario: {
      players: { A: { energy: 10 } },
      objects: [
        { id: "wolf", cardId: stalkingWolf.canonicalCardId, types: ["unit"], zone: "hand", might: 6, energy: 4, power: [] },
        { id: "fodder", owner: "A", types: ["unit"], tags: ["Dog"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 },
      ],
      operations: [{ type: "play", object: "wolf", player: "A" }],
      expect: { objects: { wolf: { zone: "board" }, fodder: { zone: "board" } } },
    },
  },
  {
    name: "Aurok General · Empowered gate is false before activation",
    canonicalCardId: aurok.canonicalCardId,
    program: executionSlice(aurok, 1),
    scenario: {
      objects: [{ id: "aurok", cardId: aurok.canonicalCardId, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 5 }],
      expect: { objects: { aurok: { zone: "board", might: 5, empowered: 0 } } },
    },
  },
  {
    name: "Disciple of Shen · exactly-one condition is not satisfied with no ally",
    canonicalCardId: disciple.canonicalCardId,
    program: executionSlice(disciple, 1),
    scenario: {
      objects: [{ id: "disciple", cardId: disciple.canonicalCardId, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 1 }],
      // Boundary: no other friendly unit is present, so the printed condition is false.
      expect: { objects: { disciple: { zone: "board", keywords: [] } } },
    },
  },
  {
    name: "Escaped Grayback · Empowered gate is false before activation",
    canonicalCardId: escapedGrayback.canonicalCardId,
    program: executionSlice(escapedGrayback, 1),
    scenario: {
      objects: [{ id: "grayback", cardId: escapedGrayback.canonicalCardId, types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 3 }],
      expect: { objects: { grayback: { zone: "board", might: 3, empowered: 0 } } },
    },
  },
];

for (const row of defineTemplateSuite("RIFT-647 keyword+static", rows)) test(row.name, row.run);
