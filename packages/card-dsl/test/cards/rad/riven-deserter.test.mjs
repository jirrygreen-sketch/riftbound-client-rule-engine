// Golden test for Riven, Deserter (rad-114-167).
// The object-exhausted trigger shape, the activated cost structure and the merged
// effect.ready body are verifiable; temporary Might, the object-valued exhaust cost
// and the once-per-turn restriction have no merged consumer.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/riven-deserter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-51aab7c27d79de8598bf1c63fd69200050369183a2f0e0d05edba616e72283a2";
const SOURCE_TEXT =
  "When another friendly unit becomes exhausted, give me +1 :rb_might: this turn.\n" +
  "Exhaust a friendly unit: Ready a unit. Use this ability only once each turn.";

const [exhaustTrigger, activated] = program.abilities;
const [grantMight] = exhaustTrigger.body;
const [readyUnit] = activated.body;
const [exhaustPayment] = activated.cost.payments;

test("rad-114-167 Riven, Deserter: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-114-167 Riven, Deserter: judgeReason names temporary Might, the exhaust cost and the usage limit", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /CostSpec/);
  assert.match(program.judgeReason, /386/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("rad-114-167 Riven, Deserter: the first ability is an object-exhausted trigger excluding this unit (415.1)", () => {
  assert.equal(exhaustTrigger.kind, "triggered");
  assert.equal(exhaustTrigger.trigger.at, "object-exhausted");
  assert.deepEqual(exhaustTrigger.trigger.filter, {
    type: "unit",
    controller: "controller",
    exclude: "source"
  });
  assert.equal(exhaustTrigger.optional, false);
});

test("rad-114-167 Riven, Deserter: the trigger grants +1 Might this turn to this unit (143.2.a.1)", () => {
  assert.equal(exhaustTrigger.body.length, 1);
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantMight.targets, [
    {
      id: "riven.self",
      filter: { object: "self", type: "unit" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-114-167 Riven, Deserter: the activated ability pays by exhausting a friendly unit and carries the once-a-turn limit", () => {
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.equal(activated.cost.payments.length, 1);
  assert.equal(exhaustPayment.kind, "exhaust");
  assert.deepEqual(exhaustPayment.choice, {
    id: "riven.exhaust-cost-unit",
    options: ["dynamic:friendly-units-on-board"],
    min: 1,
    max: 1,
    selection: "one",
    zone: "board",
    type: "unit",
    controller: "controller"
  });
  assert.deepEqual(activated.restriction, {
    kind: "usage-limit",
    value: { kind: "constant", value: 1 },
    period: "turn"
  });
});

test("rad-114-167 Riven, Deserter: the body readies one unit as a target (416.1, 355.9)", () => {
  assert.equal(activated.body.length, 1);
  assert.equal(readyUnit.id, "riven.ready-unit");
  assert.equal(readyUnit.op, "effect.ready");
  assert.deepEqual(readyUnit.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "riven.ready-target" }
  });
  assert.deepEqual(readyUnit.targets, [
    {
      id: "riven.ready-target",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-114-167 Riven, Deserter: the ready body resets an exhausted unit and ignores an already-ready one (416.1.b)", () => {
  const kernel = world()
    .unit("exhausted-ally", { exhausted: true })
    .unit("ready-ally", { exhausted: false })
    .build();
  const exhaustedRef = kernel.ref("exhausted-ally");
  const run = runInstruction(
    ready,
    { objects: { kind: "constant", value: { kind: "target", id: "riven.ready-target" } } },
    { world: kernel, targets: { "riven.ready-target": [exhaustedRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.readied, { count: 1, objects: [exhaustedRef] });
  assert.equal(kernel.getObject("exhausted-ally").exhausted, false);
  assert.equal(kernel.getObject("ready-ally").exhausted, false);

  const alreadyReady = world().unit("ready-ally", { exhausted: false }).build();
  const skipped = runInstruction(
    ready,
    { objects: { kind: "constant", value: { kind: "target", id: "riven.ready-target" } } },
    { world: alreadyReady, targets: { "riven.ready-target": [alreadyReady.ref("ready-ally")] } }
  );
  assert.equal(skipped.result.status, "executed");
  assert.deepEqual(skipped.linked.readied, { count: 0, objects: [] });
});

test("rad-114-167 Riven, Deserter: the object-exhausted trigger body runs through the interpreter", () => {
  // The reference kernel binds "self" to the context source, so the unit is
  // installed as the source snapshot (same convention as the merged Sett golden).
  const base = world()
    .unit("riven", { might: 5 })
    .unit("ally", { exhausted: false })
    .build();
  const scoped = base.clone({ sourceSnapshot: base.getObject("riven") });
  scoped.setTargets("riven.self", [base.ref("riven")]);
  // continuous.might is unregistered, so the trigger body cannot execute: the
  // interpreter rejects the opcode rather than silently approximating it.
  assert.throws(
    () => runAbilityBody(exhaustTrigger.body, scoped),
    /Unregistered instruction opcode: continuous\.might/
  );
  assert.equal(scoped.getObject("riven").might, 5);
  assert.equal(scoped.getObject("ally").exhausted, false);
});

test.todo(
  "rad-114-167 Riven, Deserter: 'give me +1 Might this turn' applied in the Arithmetic layer and expiring at " +
    "end of turn (CR 143.2.a.1/475) — continuous.might is not merged (RIFT-91)"
);
test.todo(
  "rad-114-167 Riven, Deserter: 'Exhaust a friendly unit' as a cost selecting a runtime object (CR 415.3.a, " +
    "355.5) — CostSpec picks carry static options, so the cost system cannot resolve an on-board unit reference " +
    "(RIFT-89)"
);
test.todo(
  "rad-114-167 Riven, Deserter: 'Use this ability only once each turn' enforced (CR 386/386.1) — the " +
    "activation limit has no consumer in chain/cost; card triggers also have no registration yet (RIFT-120)"
);

