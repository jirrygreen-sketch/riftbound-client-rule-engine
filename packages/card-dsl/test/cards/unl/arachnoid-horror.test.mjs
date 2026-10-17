// Golden test for Arachnoid Horror (unl-117-219).
//
// Execution evidence (the real printed 6 Energy + 1 Body Power payment, the
// fail-closed play-location-permission binds and the blocked Hunt trigger
// registration) lives in the RIFT-673 parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// Original behavior and structure assertions remain in this file; the
// template adds execution evidence without replacing these checks.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/arachnoid-horror.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-158f0c8fe09a511b90b88574669f5f31fbfc1742ef2b6dea8f7b903e7a448423";
const SOURCE_TEXT =
  "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
  "I can be played to an occupied battlefield if an enemy unit is alone there.\n" +
  "Friendly units can be played to an occupied battlefield if an enemy unit is alone there.";

const [hunt, selfPermission, friendlyPermission] = program.abilities;

test("unl-117-219 Arachnoid Horror: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-117-219 Arachnoid Horror: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /740\.2\.a/);
  assert.match(program.judgeReason, /occupied/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.match(program.judgeReason, /EventPattern/);
  assert.match(program.judgeReason, /conquer\/hold/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(257|357|359|265)/);
});

test("unl-117-219 Arachnoid Horror: [Hunt 2] is a valued keyword declaration (823.1.c)", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 2 });
  // 823.1.c.3: the 2 is the Hunt Value; the card never restates the XP clause.
  assert.equal(hunt.value, 2);
});

test("unl-117-219 Arachnoid Horror: the two printed play permissions are static, not triggered", () => {
  // 355.2.b: game effects may make locations valid that are not valid by default
  // (355.2.a). Both sentences are passive permissions, so neither becomes a
  // trigger or an activated ability.
  assert.equal(selfPermission.kind, "static");
  assert.equal(friendlyPermission.kind, "static");
  assert.equal(program.abilities.filter(ability => ability.kind === "triggered").length, 0);
});

test("unl-117-219 Arachnoid Horror: 'I can be played to an occupied battlefield if an enemy unit is alone there'", () => {
  assert.equal(selfPermission.effect.kind, "play-location-permission");
  assert.deepEqual(selfPermission.effect.value, {
    kind: "constant",
    value: {
      zone: "battlefield",
      // 170.11.a: occupied means a Unit is present. 740.2.a: alone means no other
      // friendly unit at the same location; enemyUnitAlone is the placeholder for
      // that predicate (no merged ObjectFilter anchor evaluates it).
      battlefield: { occupied: true, enemyUnitAlone: true },
      appliesTo: "self"
    }
  });
  // The permission is active while the card is in hand, i.e. while it is played.
  assert.equal(selfPermission.effect.duration, "while-in-hand");
  assert.equal(selfPermission.condition, undefined);
});

test("unl-117-219 Arachnoid Horror: the second sentence extends the same permission to friendly units", () => {
  assert.equal(friendlyPermission.effect.kind, "play-location-permission");
  assert.deepEqual(friendlyPermission.effect.value, {
    kind: "constant",
    value: {
      zone: "battlefield",
      battlefield: { occupied: true, enemyUnitAlone: true },
      appliesTo: "friendly-units"
    }
  });
  // A permanent's passive ability applies while it is on the board (365.1/366).
  assert.equal(friendlyPermission.effect.duration, "while-on-board");
});

test("unl-117-219 Arachnoid Horror golden: the Hunt 2 clause is exactly effect.xp with amount 2 (823.1.c.1)", () => {
  // The expanded body is “my controller gains 2 XP”, so its merged commit step
  // is exercised directly on the real primitive.
  const kernel = world().build();
  // 823.1.c.3: the printed Hunt Value is what the expansion feeds to effect.xp.
  const run = runInstruction(xp, { amount: { kind: "constant", value: hunt.value } }, { world: kernel });

  assert.equal(xp.op, "effect.xp");
  assert.equal(hunt.value, 2);
  assert.equal(run.result.status, "executed");
  // 728 / 730.1: the controller's marked XP increases by the Hunt Value (2).
  assert.equal(kernel.player("A").xp, 2);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(run.linked.gained, 2);
  assert.equal(run.linked.gainedTo, "A");
  assert.deepEqual(run.events.map(event => event.action), ["gain-xp"]);
});

test("unl-117-219 Arachnoid Horror golden: a replaced XP gain marks nothing (367, 730.1)", () => {
  const kernel = world().build();
  kernel.addReplacement(action => (action.type === "gain-xp" ? "replaced" : null));
  const run = runInstruction(xp, { amount: { kind: "constant", value: 2 } }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(kernel.player("A").xp, 0);
});

test("unl-117-219 Arachnoid Horror: the merged Hunt KeywordDef expands this card's Hunt 2 into the printed triggers", () => {
  // The merged effects/keywords/Hunt.ts: 823.1.c.1 turns Hunt into one
  // trigger per timing point whose body is the merged effect.xp primitive, and
  // 823.1.c.3 passes the card's printed value (2) through.
  const huntDef = keywordDefinitionsById.get("Hunt");
  assert.ok(huntDef, "effects/keywords/Hunt.ts must be registered");
  assert.equal(huntDef.valued, true);
  assert.equal(huntDef.stacking, "sum");

  const expanded = huntDef.expand({ value: hunt.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expanded.map(ability => [ability.kind, ability.trigger.at]), [
    ["triggered", "conquer"],
    ["triggered", "hold"]
  ]);
  for (const ability of expanded) {
    assert.deepEqual(ability.body.map(step => [step.id, step.op]), [
      [`hunt:${CANONICAL_ID}:${ability.trigger.at}:xp`, "effect.xp"]
    ]);
    // 823.1.c.3: the expansion feeds the printed Hunt Value, not a default.
    assert.deepEqual(ability.body[0].args.amount, { kind: "constant", value: 2 });
    // The expansion's own event spelling is the frozen trigger vocabulary's
    // 'conquer'; pipeline-match.ts maps the card-side 'conquered'/held aliases
    // onto the conquer/hold timing points.
    assert.deepEqual(ability.trigger.filter, {
      event: ability.trigger.at,
      filter: { source: "self" }
    });
  }
});

test("unl-117-219 Arachnoid Horror: the expanded Hunt 2 body really gains the printed 2 XP", () => {
  // 823.1.c.1 / 728 / 730.1: the expansion's body is the merged effect.xp
  // primitive, so the XP really reaches the controller's marked XP.
  const huntDef = keywordDefinitionsById.get("Hunt");
  const [conquer] = huntDef.expand({ value: hunt.value, host: { canonicalCardId: CANONICAL_ID } });
  const kernel = world().build();
  const run = runInstruction(xp, conquer.body[0].args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").xp, 2);
  assert.equal(kernel.player("B").xp, 0);
});

test("unl-117-219 Arachnoid Horror: the trigger translator constructs the two object-bound Hunt subscriptions", () => {
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const f = fixture({ cards: [{ id: "arachnoid", cardId: CANONICAL_ID, types: ["unit"], might: 6, energy: 6, power: null }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("arachnoid"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  const source = f.kernel.getObject("arachnoid");
  const registrations = triggerRegistrations(binding.registry, source);
  assert.deepEqual(registrations.map(registration => registration.spec.at), ["conquer", "hold"]);
  assert.deepEqual(registrations.map(registration => registration.spec.filter), [
    { event: "conquer", object: { objectId: "arachnoid" } },
    { event: "hold", object: { objectId: "arachnoid" } }
  ]);
});
test.todo(
  "Arachnoid Horror: register the original Hunt expansion in the real pipeline after aligning the " +
    "conquer/hold filter events with the conquered/held EventPattern vocabulary (823.1.c.1); " +
    "the current registration validator rejects the expansion before the alias matcher can run"
);
test.todo(
  "unl-117-219 Arachnoid Horror: both play-location permissions reach the Make Relevant Choices location choice " +
    "(CR 355.2.b) and the “enemy unit is alone there” gate is evaluated with the 740.2.a predicate " +
    "— no consumer of play-location-permission is merged (same gap as sfd/dauntless-vanguard, ogn/miss-fortune-buccaneer)"
);

test.todo(
  "Arachnoid Horror: match the scoring wave's battlefieldId to Hunt units present there " +
    "(383.4.c.2.a / 383.4.d.2.a / 823.1.c.1); the translated objectId filter requires unit attribution"
);
