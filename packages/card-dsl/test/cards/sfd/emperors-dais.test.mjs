import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/emperors-dais.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const constant = value => ({ kind: "constant", value });
const [ability] = program.abilities;
const [choice] = ability.body;
const [pay, returnUnit, readHere, sandSoldier] = choice.args.body.value;

test("sfd-207-221 Emperor's Dais: validates, is registered and keeps identity/source text", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(
    program.canonicalCardId,
    "card.hash-0049ad19b30eb5fd30b02674e302272e9df4b060fbe5a8e672fb9f5bb9c5e417"
  );
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.equal(
    program.sourceText,
    "When you conquer here, you may pay :rb_energy_1: and return a unit you control here to its owner's hand. If you do, play a 2 :rb_might: Sand Soldier unit token here."
  );
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("sfd-207-221 Emperor's Dais: conquer trigger and optional pay → return → token structure", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquer", here: true, player: "self" });
  assert.equal(ability.optional, true);
  assert.equal(ability.body.length, 1);
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), [
    "emperors-dais.pay",
    "emperors-dais.return-unit",
    "emperors-dais.read-here",
    "emperors-dais.sand-soldier"
  ]);

  assert.equal(pay.op, "cost.pay");
  assert.equal(pay.linkedTo, undefined);
  assert.deepEqual(pay.args.energy, constant(1));
  assert.deepEqual(pay.args.power, constant([]));

  assert.equal(returnUnit.op, "effect.zone");
  assert.equal(returnUnit.linkedTo, "emperors-dais.pay");
  assert.deepEqual(returnUnit.args.target, constant("emperors-dais.unit-here"));
  assert.deepEqual(returnUnit.args.to, constant("hand"));
  assert.equal(returnUnit.targets.length, 1);
  assert.equal(returnUnit.targets[0].id, "emperors-dais.unit-here");
  assert.deepEqual(returnUnit.targets[0].filter, {
    type: "unit",
    controller: "self",
    sameLocationAs: "source"
  });
  assert.equal(returnUnit.targets[0].min, 1);
  assert.equal(returnUnit.targets[0].max, 1);
  assert.equal(returnUnit.targets[0].selection, "one");

  // "If you do": the card-text half is gated on the payment step (204.3.a/205).
  assert.equal(readHere.op, "condition.value");
  assert.deepEqual(readHere.args.value, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.deepEqual(readHere.args.key, constant("here"));

  assert.equal(sandSoldier.op, "effect.token");
  assert.equal(sandSoldier.linkedTo, "emperors-dais.pay");
  assert.deepEqual(sandSoldier.args.token, constant("sand-soldier"));
  assert.deepEqual(sandSoldier.args.amount, constant(1));
  assert.deepEqual(sandSoldier.args.mode, constant("play"));
  // "here": the source's own location, bound by condition.value and read back
  // through the linked value (the merged royal-guard / azir-ascendant shape).
  assert.deepEqual(sandSoldier.args.location, {
    kind: "linked-value",
    instructionId: "emperors-dais.read-here",
    key: "here"
  });
  assert.deepEqual(sandSoldier.args.linkKey, constant("sandSoldier"));
});

test("sfd-207-221 Emperor's Dais: the return-to-hand half moves to the printed owner via return-to-hand", () => {
  // A controls the unit; B owns it; 460/124 route the card to its owner's hand.
  const kernel = world()
    .player("B")
    .unit("u1", { controller: "A", owner: "B", location: BATTLEFIELD })
    .build();
  // The reference kernel does not run the production adapter's literal
  // decoding (chain/interpreter-adapter.ts LITERAL_FIELDS['effect.zone']), so
  // the printed constant-wrapped TargetSpec id is supplied in its decoded
  // form here; the card itself keeps the Expr-shaped argument.
  const run = runInstruction(zone, { target: "emperors-dais.unit-here", to: constant("hand") }, {
    world: kernel,
    targets: { "emperors-dais.unit-here": [kernel.ref("u1")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.zone("A", "hand").length, 0);
  assert.deepEqual(kernel.zone("B", "hand").map(ref => ref.id), ["u1"]);
  assert.deepEqual(kernel.zone("A", "board"), []);
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
});

test("sfd-207-221 Emperor's Dais golden: the declared \"here\" read binds the source's own location", () => {
  const base = world()
    .unit("dais", { types: ["battlefield"], location: BATTLEFIELD })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("dais") });

  // Only the supported instruction runs: cost.pay is not registered yet
  // (RIFT-261), so the whole authored body cannot be interpreted end to end.
  const outcome = resolveChainBody([readHere], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues["emperors-dais.read-here.here"], BATTLEFIELD);
});

test("sfd-207-221 Emperor's Dais golden: the card's own token instruction plays the Sand Soldier at that linked location", () => {
  const kernel = world().player("A").build();
  // The linked value is the one the preceding condition.value instruction
  // writes (key "here"); the instruction itself is the card's own argument set.
  const run = runInstruction(token, sandSoldier.args, {
    world: kernel,
    linked: { here: BATTLEFIELD }
  });

  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  const [soldier] = created;
  assert.equal(soldier.name, "Sand Soldier");
  assert.equal(soldier.might, 2);
  assert.deepEqual(soldier.tags, ["Shurima"]);
  assert.deepEqual(soldier.location, BATTLEFIELD);
  // 185.3: tokens have no printed costs — null, never 0.
  assert.equal(soldier.energy, null);
  assert.equal(soldier.power, null);
  assert.deepEqual(run.linked["sandSoldier.objects"], [soldier.ref]);
  assert.deepEqual(run.events.map(event => event.action), ["create-token", "play"]);
});

// The 1-energy payment still has no merged instruction primitive (RIFT-261
// cost.pay/cost.modify), so the "If you do" receipt cannot be produced yet.
test.todo(
  "sfd-207-221 Emperor's Dais: pay 1 energy and gate the Sand Soldier on the payment receipt (cost.pay, RIFT-261)"
);
test.todo(
  "sfd-207-221 Emperor's Dais: 383.3.b base-cost handling for the cost within instructions right after 'you may' (cost/trigger Finalize)"
);
