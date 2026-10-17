import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/emperors-dais.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const constant = value => ({ kind: "constant", value });
const [ability] = program.abilities;
const [choice] = ability.body;
const [pay, returnUnit, readHere, sandSoldier] = choice.args.body.value;

// The interpreter resolves sameLocationAs against the source. Bind the scalar
// controller selector as the production chain query does, preserving the IR.
function controllerContext(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") return filter => {
        const normalized = translateObjectFilter(filter);
        if (normalized.controller === "self") normalized.controller = target.controller;
        return target.query(normalized);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

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
  assert.match(program.judgeReason, /383\.3\.a/);
  assert.match(program.judgeReason, /CR 205/);
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
  assert.deepEqual(ability.trigger.filter, { event: "conquered", here: true, player: "self" });
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
  // 204.3.a/205/356: the 1-energy payment is cost.pay's finalized payments
  // record — a plain { energy } value, not an array-shaped pseudo plan.
  assert.deepEqual(pay.args, {
    payments: { kind: "constant", value: { energy: 1 } }
  });

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
  assert.equal(sandSoldier.linkedTo, "emperors-dais.return-unit");
  assert.deepEqual(sandSoldier.condition, {
    kind: "compare",
    left: { kind: "linked-value", instructionId: "emperors-dais.return-unit", key: "moved" },
    operator: "eq",
    right: constant(1)
  });
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

  // Bind the authored source-location expression through the real interpreter.
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

// These are sub-effect executions. CR 383.3.a requires the leading optional
// decision at Finalize; CR 205 keeps the resource payment at resolution.
test("sfd-207-221 Emperor's Dais golden: the authored sub-effect sequence pays 1 energy, returns the unit and plays the Sand Soldier", () => {
  const base = world()
    .player("A", { energy: 1, power: [] })
    .player("B", { power: [] })
    .unit("dais", { types: ["battlefield"], power: [], location: BATTLEFIELD })
    .unit("u1", { controller: "A", owner: "B", power: [], location: BATTLEFIELD })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("dais") });
  kernel.setTargets("emperors-dais.unit-here", [kernel.ref("u1")]);
  kernel.setAnswers({ "emperors-dais.opt-in/optional": true });

  const outcome = resolveChainBody(ability.body, controllerContext(kernel));

  // The optional wrapper accepted, the payment executed and both gated
  // instructions ran: the token also requires the actual return receipt (205).
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["emperors-dais.pay", "executed"],
      ["emperors-dais.return-unit", "executed"],
      ["emperors-dais.read-here", "executed"],
      ["emperors-dais.sand-soldier", "executed"],
      ["emperors-dais.opt-in", "executed"]
    ]
  );
  // cost.pay really charged the controller's energy pool (204.3.a).
  assert.equal(kernel.player("A").energy, 0);
  // 460: the returned unit went to its OWNER's hand, not the controller's.
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["u1"]);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), []);
  assert.equal(kernel.zone("A", "board").filter((object) => object.id === "u1").length, 0);
  // "If you do": the token was created and played here (440.2.c / 185.2.a).
  const soldier = kernel.query({ zone: "board", type: "unit" }).find((object) => object.isToken);
  assert.ok(soldier, "the Sand Soldier must exist on the battlefield");
  assert.equal(soldier.name, "Sand Soldier");
  assert.equal(soldier.might, 2);
  assert.deepEqual(soldier.location, BATTLEFIELD);
  assert.deepEqual(soldier.tags, ["Shurima"]);
  assert.equal(soldier.energy, null);
  assert.equal(soldier.power, null);
  const actions = outcome.events.map((event) => event.action);
  assert.equal(actions.filter((action) => action === "pay").length, 1);
  assert.equal(actions.includes("return-to-hand"), true);
  assert.equal(actions.includes("create-token"), true);
  assert.equal(actions.includes("play"), true);
});

test("sfd-207-221 Emperor's Dais golden: declining the optional payment skips the whole gated body", () => {
  const base = world()
    .player("A", { energy: 1, power: [] })
    .player("B", { power: [] })
    .unit("dais", { types: ["battlefield"], power: [], location: BATTLEFIELD })
    .unit("u1", { controller: "A", owner: "B", power: [], location: BATTLEFIELD })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("dais") });
  kernel.setTargets("emperors-dais.unit-here", [kernel.ref("u1")]);
  kernel.setAnswers({ "emperors-dais.opt-in/optional": false });

  const outcome = resolveChainBody(ability.body, controllerContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => entry.result.status), ["negated"]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  // Nothing else ran: the pool, the unit and the board are untouched.
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(kernel.getObject("u1").location, BATTLEFIELD);
  assert.equal(kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken).length, 0);
  assert.deepEqual(kernel.events, []);
});

test("sfd-207-221 Emperor's Dais golden: the payment alone is the merged cost.pay energy settlement", () => {
  // The merged cost.pay primitive really charges the acting seat. The battle
  // field is the source so the plan's locked source matches the resolution.
  const base = world()
    .player("A", { energy: 2, power: [] })
    .unit("dais-probe", { types: ["battlefield"], power: [] })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("dais-probe") });
  const run = runInstruction(costPay, pay.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").energy, 1);
  assert.equal(run.events.filter((event) => event.action === "pay").length, 1);
  assert.deepEqual(run.linked.payment.actions.map((action) => action.action.type), ["pay"]);
});

test("sfd-207-221 Emperor's Dais golden: an unaffordable payment aborts before any return or token", () => {
  const base = world()
    .player("A", { energy: 0, power: [] })
    .unit("dais", { types: ["battlefield"], location: BATTLEFIELD })
    .unit("ally", { location: BATTLEFIELD })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("dais") });
  kernel.setTargets("emperors-dais.unit-here", [kernel.ref("ally")]);
  kernel.setAnswers({ "emperors-dais.opt-in/optional": true });

  assert.throws(() => resolveChainBody(ability.body, controllerContext(kernel)), error => error.reason === "cannot-pay-cost");
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.getObject("ally").location, BATTLEFIELD);
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.query({ type: "unit" }).filter(object => object.isToken).length, 0);
});

test.todo(
  "sfd-207-221 Emperor's Dais: bind conquer-here and target sameLocationAs, and lift only the leading " +
    "optional decision into Finalize (383.3.a); the Energy/return actions stay at resolution (205)"
);

test("sfd-207-221 Emperor's Dais sub-effect golden: a stale return target cannot create a Soldier", () => {
  const base = world()
    .player("A", { energy: 1, power: [] })
    .unit("dais", { types: ["battlefield"], location: BATTLEFIELD })
    .unit("ally", { location: BATTLEFIELD })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("dais") });
  const stale = kernel.ref("ally");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  kernel.setTargets("emperors-dais.unit-here", [stale]);
  kernel.setAnswers({ "emperors-dais.opt-in/optional": true });
  const eventCount = kernel.events.length;

  // Isolated body only: the leading optional decision belongs at Finalize.
  const outcome = resolveChainBody(ability.body, controllerContext(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.find(entry => entry.id === returnUnit.id).result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.results.find(entry => entry.id === sandSoldier.id).result, { status: "ignored", reason: "linked-ignored" });
  assert.deepEqual(kernel.events.slice(eventCount).map(event => event.action), ["pay"]);
  assert.equal(kernel.objects.filter(object => object.isToken).length, 0);
});
