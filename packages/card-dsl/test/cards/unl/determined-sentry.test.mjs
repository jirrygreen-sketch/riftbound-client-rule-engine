import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/determined-sentry.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";

const CANONICAL_ID =
  "card.hash-1fdab35e21db7372013c7ccc1c69b1ebf752b66cdac3f9cef733a8a4619b112b";
const SOURCE_TEXT = "I can't move to base.";

const [ability] = program.abilities;

function unit(overrides = {}) {
  return {
    ref: { id: "determined-sentry", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Determined Sentry",
    types: ["unit"],
    tags: ["Yordle", "Bandle City"],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    might: 1,
    energy: 1,
    power: ["Body"],
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

test("unl-111-219 Determined Sentry: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-111-219 Determined Sentry: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 054 / 054.1 (“Can’t beats Can”) is the operative rule; the reason must also
  // name the missing consumer.
  assert.match(program.judgeReason, /054/);
  assert.match(program.judgeReason, /144\.4\.b/);
  assert.match(program.judgeReason, /zones\/movement/);
});

test("unl-111-219 Determined Sentry: one passive movement restriction on the host", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  assert.equal(ability.effect.kind, "continuous.movement");
  assert.equal(ability.effect.restriction, "move-to-base");
  // 054.1: a prohibition only removes the option; it grants nothing.
  assert.equal(ability.effect.addsPermission, false);
  assert.equal(ability.effect.permission, undefined);
  // 053.1 / contract 3.6: "I" is the ability host.
  assert.deepEqual(ability.effect.filter, { object: "self" });
});

test("unl-111-219 Determined Sentry golden: the merged layer engine records the declared restriction", () => {
  const subject = unit();
  const engine = createLayerEngine([subject], [
    {
      effect: {
        id: "determined-sentry",
        layer: "ability",
        filter: ability.effect.filter,
        source: subject.ref,
        effect: ability.effect
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects([subject]);

  const snapshot = engine.evaluate(subject.ref);
  assert.deepEqual(snapshot.movement.restrictions, ["move-to-base"]);
  // A prohibition does not flip the baseline permission flags.
  assert.equal(snapshot.movement.allowed, true);
  assert.equal(snapshot.movement.canMove, true);
  assert.equal(snapshot.movement.canGank, false);
});

test("unl-111-219 Determined Sentry gap: effect.move still sends the unit to its Base while the restriction is recorded", () => {
  // 054.1 / 451.1 require the prohibition to negate the Move at resolution.
  // The restriction is recorded by the layer engine (test above) but nothing
  // consumes it, so the merged move primitive relocates the unit. This is the
  // concrete blocking gap behind the judge-required status.
  const subject = unit();
  const engine = createLayerEngine([subject], [
    {
      effect: {
        id: "determined-sentry",
        layer: "ability",
        filter: ability.effect.filter,
        source: subject.ref,
        effect: ability.effect
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects([subject]);
  assert.deepEqual(engine.evaluate(subject.ref).movement.restrictions, ["move-to-base"]);

  const kernel = world().unit("determined-sentry", { location: { type: "battlefield", id: "battlefield-1" } }).build();
  const ref = kernel.ref("determined-sentry");
  const run = runInstruction(
    move,
    { objects: { kind: "constant", value: { target: "sentry" } }, to: { kind: "constant", value: "controller-base" } },
    { world: kernel, targets: { sentry: [ref] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("determined-sentry").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.events.map(event => event.action), ["move-location"]);
});

test("unl-111-219 Determined Sentry golden: RIFT-259's movement query serves the continuous.movement spec to a caller", () => {
  // RIFT-329 re-review: the rules-query layer is merged and really reports a
  // recorded restriction together with the object it applies to. The spec below
  // is the shape continuous.movement (the merged primitive) writes:
  // { kind: "movement", restrictions: [...] }. It has no production caller yet
  // (zones/movement.ts and move-location validate from their own inputs), and
  // the raw card declaration's singular "restriction" field is the primitive's
  // arg spelling, not the spec field the query reads — both gaps are recorded
  // in the judgeReason.
  const subject = unit();
  const registry = new ContinuousEffectRegistry();
  registry.register(
    {
      id: "determined-sentry",
      layer: "ability",
      source: subject.ref,
      filter: ability.effect.filter,
      effect: { kind: "movement", restrictions: [ability.effect.restriction] }
    },
    { type: "permanent" }
  );

  const view = movement(registry, subject.ref, subject, subject.controller);

  assert.deepEqual(view.restrictions, ["move-to-base"]);
  assert.equal(view.allowed, true);
  assert.equal(view.canMove, true);
  assert.equal(view.canGank, false);
  // The restriction applies to the host object only (053.1/053.2).
  assert.deepEqual(movement(registry, { id: "somebody-else", zoneEntryId: 1 }), {
    allowed: true,
    canMove: true,
    canGank: false,
    battlefieldToBattlefield: false,
    restrictions: [],
    permissions: []
  });
});
