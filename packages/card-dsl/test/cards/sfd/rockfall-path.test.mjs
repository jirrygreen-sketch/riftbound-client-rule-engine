// RIFT-643: static|| execution evidence is consolidated in ../templates/static-643.test.mjs.
// This file retains the card's identity, status, sourceText, and key IR guards.

import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/rockfall-path.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-0bf84d1f197b32b1d70c409fd2d0f0fe59c23923e72f6f7eeb77cb1e4376db7d";
const SOURCE_TEXT = "Units can't be played here.";

const [ability] = program.abilities;

function unit(id, overrides = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: "card:" + id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    might: 2,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...overrides
  };
}

test("sfd-216-221 Rockfall Path: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("sfd-216-221 Rockfall Path: identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // Build-time codegen over src/cards/**; the golden proves the identity is
  // actually registered (one identity, one file).
  assert.equal(cardProgramsById.get(CANONICAL), program);
  // 054/054.1 is the operative rule; the reason must name the missing
  // primitive/consumer, not just "not implemented".
  assert.match(program.judgeReason, /054/);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /no-battlefield/);
  // The remaining gap is this Battlefield's destination-specific prohibition.
  assert.match(program.judgeReason, /playDestinationIsLegal/);
  assert.match(program.judgeReason, /static/);
  assert.match(program.judgeReason, /sameLocationAs/);
});

test("sfd-216-221: one static prohibition on playing units at this Battlefield (054.1, 053.3)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 054.1: a prohibition removes the option and never grants one.
  assert.equal(ability.effect.kind, "continuous.restrict");
  assert.equal(ability.effect.restriction, "units-cannot-be-played-here");
  assert.equal(ability.effect.prohibits, true);
  // 355.2: the prohibited action applies to Units, and "here" (053.3) is this
  // Battlefield.
  assert.equal(ability.effect.action, "play");
  assert.equal(ability.effect.cardType, "unit");
  assert.equal(ability.effect.location, "self");
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  // No instruction is encoded: the ability is a passive prohibition with no
  // chain interaction (contract 3.1 static).
  assert.equal("body" in ability, false);
  assert.equal("with" in ability, false);
});

test("sfd-216-221: continuous.restrict is merged, and the layer snapshot carries no play restriction", () => {
  // A play-destination prohibition belongs to the rules query, while the
  // movement snapshot below keeps its independent default permissions.
  const definition = instructionDefinitionsById.get("continuous.restrict");
  assert.ok(definition, "the merged registry must carry continuous.restrict");
  assert.equal(definition.op, "continuous.restrict");

  const unitHere = unit("unit-here");
  const engine = createLayerEngine([unitHere], [
    {
      effect: {
        id: "rockfall-path",
        layer: "ability",
        filter: ability.effect.filter,
        effect: { kind: "continuous.restrict", restriction: ability.effect.restriction }
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects([unitHere]);

  const snapshot = engine.evaluate(unitHere.ref);
  // The prohibition is not recorded anywhere on the unit: a play restriction
  // belongs to the Battlefield's Valid Locations (355.2.b), and the layer
  // engine only knows movement permissions.
  assert.deepEqual(snapshot.movement.restrictions, []);
  assert.equal(snapshot.movement.allowed, true);
  assert.equal(snapshot.movement.canMove, true);
  assert.equal(snapshot.movement.canGank, false);
  assert.equal(snapshot.keywords.length, 0);
});

test("sfd-216-221: the merged restriction primitive registers its generic action spec", () => {
  // This generic primitive registration works. It does not supply the
  // destination identity needed to prohibit only Rockfall Path.
  const kernel = world().unit("enemy-mech").build();
  const outcome = resolveChainBody(
    [{ id: "prohibition", op: "continuous.restrict", args: {
      mode: { kind: "constant", value: "prohibit" },
      action: { kind: "constant", value: ["play"] },
      restriction: { kind: "constant", value: "units-cannot-be-played-here" }
    } }],
    kernel
  );
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registered] = kernel.continuousEffects;
  assert.equal(registered.effect.layer, "ability");
  assert.deepEqual(registered.effect.effect.actions, ["play"]);
  assert.equal(registered.effect.effect.restriction, "units-cannot-be-played-here");
  assert.deepEqual(registered.duration, { type: "permanent" });
  // Execution exists; the card-specific destination adapter remains blocked.
  assert.equal(typeof instructionDefinitionsById.get("continuous.restrict").execute, "function");
});

test.todo(
  "sfd-216-221: the merged continuous.restrict registration must be consulted when computing a " +
    "unit's Valid Locations (355.2.b) during Finalize, so playing a unit here is prohibited " +
    "(054/054.1), preserving other Battlefield and Base destinations; static registration and generic queries already exist"
);
