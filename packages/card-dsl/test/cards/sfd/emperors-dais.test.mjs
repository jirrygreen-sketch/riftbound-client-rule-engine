import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/emperors-dais.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const constant = value => ({ kind: "constant", value });
const [ability] = program.abilities;
const [choice] = ability.body;
const [pay, returnUnit, sandSoldier] = choice.args.body.value;

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
  assert.equal(sandSoldier.op, "effect.token");
  assert.equal(sandSoldier.linkedTo, "emperors-dais.pay");
  assert.deepEqual(sandSoldier.args.token, constant("sand-soldier"));
  assert.deepEqual(sandSoldier.args.amount, constant(1));
  assert.deepEqual(sandSoldier.args.mode, constant("play"));
  assert.deepEqual(sandSoldier.args.location, {
    kind: "object-property",
    object: "source",
    property: "location"
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

test("sfd-207-221 Emperor's Dais: the Sand Soldier half plays the CR 187.3 token here", () => {
  const kernel = world().unit("dais", { types: ["battlefield"], location: BATTLEFIELD }).build();
  // The kernel has no static ObjectSelector host binding for object-property,
  // so the "here" object-property is supplied as the concrete source location
  // (same substitution convention as the merged royal-guard golden test);
  // the card keeps { object: "source", property: "location" }.
  const run = runInstruction(token, {
    token: constant("sand-soldier"),
    amount: constant(1),
    mode: constant("play"),
    location: constant(BATTLEFIELD),
    linkKey: constant("sandSoldier")
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  const [soldier] = created;
  assert.equal(soldier.name, "Sand Soldier");
  assert.equal(soldier.might, 2);
  assert.deepEqual(soldier.tags, ["Shurima"]);
  assert.deepEqual(soldier.location, BATTLEFIELD);
  assert.equal(soldier.energy, null);
  assert.equal(soldier.power, null);
  assert.deepEqual(run.linked["sandSoldier.objects"], [soldier.ref]);
  assert.deepEqual(run.events.map(event => event.action), ["create-token", "play"]);
});

// The 1-energy payment has no merged primitive (RIFT-89 cost.*), so the
// "If you do" receipt cannot be produced and the full chain is not executable.
test.todo(
  "sfd-207-221 Emperor's Dais: pay 1 energy and gate the Sand Soldier on the payment receipt (cost.pay, RIFT-89)"
);
test.todo(
  "sfd-207-221 Emperor's Dais: 383.3.b base-cost handling for the cost within instructions right after 'you may' (cost/trigger Finalize)"
);
