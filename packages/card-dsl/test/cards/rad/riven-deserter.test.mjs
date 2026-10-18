// Golden test for Riven, Deserter (rad-114-167).
// The object-exhausted trigger shape, the +1 Might registration, the activated
// cost structure and the merged effect.ready body are verifiable through the real
// interpreter and layer engine; the object-valued exhaust cost and the
// once-per-turn restriction are the parts still named in judgeReason.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/riven-deserter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { translateRestriction } from "../../../../engine-core/dist/programs/play.js";
import { translateInstructionTargets, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";

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
  assert.match(program.judgeReason, /choiceObjects/);
  assert.match(program.judgeReason, /386/);
  // The reason must name the merged code that rejects each half, not task ids.
  assert.match(program.judgeReason, /exact object reference/);
  assert.match(program.judgeReason, /translateRestriction|rules adapter/);
  assert.match(program.judgeReason, /Unsupported filter field exclude/);
  assert.match(program.judgeReason, /Unsupported filter field object/);
  assert.equal(/RIFT-\d+/.test(program.judgeReason), false);
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

test("rad-114-167 Riven, Deserter: the object-exhausted trigger body registers +1 Might this turn", () => {
  // The reference kernel binds "self" to the context source, so the unit is
  // installed as the source snapshot (same convention as the merged Sett golden).
  const base = world()
    .unit("riven", { might: 5 })
    .unit("ally", { exhausted: false })
    .build();
  const scoped = base.clone({ sourceSnapshot: base.getObject("riven") });
  scoped.setTargets("riven.self", [base.ref("riven")]);

  const outcome = runAbilityBody(exhaustTrigger.body, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["riven.grant-plus-one", "executed"]
  ]);
  // 143.2.a.1 / 475: one arithmetic-layer registration for the resolved host.
  assert.equal(scoped.continuousEffects.length, 1);
  const [registration] = scoped.continuousEffects;
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.equal(registration.effect.layer, "arithmetic");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.deepEqual(outcome.linkedValues["riven.grant-plus-one.affected"], {
    count: 1,
    objects: [base.ref("riven")]
  });
  // The exhausted ally is not the affected object; the body never touches it.
  assert.equal(scoped.getObject("ally").exhausted, false);
});

test("rad-114-167 Riven, Deserter: the +1 Might registration really raises the layered Might and expires at turn end", () => {
  const base = world().unit("riven", { might: 5 }).build();
  const scoped = base.clone({ sourceSnapshot: base.getObject("riven") });
  scoped.setTargets("riven.self", [base.ref("riven")]);
  const outcome = runAbilityBody(exhaustTrigger.body, scoped);
  assert.equal(outcome.status, "executed");

  const riven = scoped.getObject("riven");
  const engine = createLayerEngine(new Map([[`${riven.ref.id}:${riven.ref.zoneEntryId}`, riven]]));
  for (const entry of scoped.continuousEffects) engine.register(entry.effect, entry.duration);

  assert.equal(engine.evaluate(riven.ref).might, 6);
  // CR 317.1.a / 317.2.c: "this turn" expires at the turn-end timing point.
  const expired = engine.expireAt("turn-end", "A");
  assert.equal(expired.length, 1);
  assert.equal(engine.evaluate(riven.ref).might, 5);
});

test("rad-114-167 Riven, Deserter: the +1 Might body is the merged continuous.might primitive", () => {
  const kernel = world().unit("riven", { might: 5 }).build();
  const run = runInstruction(
    might,
    { amount: grantMight.args.amount, duration: grantMight.args.duration, target: "riven.self" },
    { world: kernel.clone({ sourceSnapshot: kernel.getObject("riven") }), targets: { "riven.self": [kernel.ref("riven")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.affected.count, 1);
});

test.todo(
  "rad-114-167 Riven, Deserter: 'Exhaust a friendly unit' as a cost selecting a runtime object (CR 415.3.a, " +
    "355.5) — the cost planner only accepts concrete PickSpec options; cost.pay and cost.modify are merged " +
    "but accept concrete references only"
);
test.todo(
  "rad-114-167 Riven, Deserter: 'Use this ability only once each turn' enforced (CR 386/386.1) — the " +
    "activation limit reaches translateLegalityCondition's rules adapter (programs/play.ts), and the " +
    "object-exhausted trigger's CardProgram -> TriggerRegistration adapter is merged, but its " +
    "exclude/controller filter shape still needs concrete ObjectFilter support"
);

test("rad-114-167 Riven, Deserter: the declared cost options cannot be resolved to runtime objects", () => {
  // CR 415.3.a / 355.5: the payer needs an exact { id, zoneEntryId } and cannot
  // query the Board from filter/zone/type/controller metadata, so the authored
  // "dynamic:friendly-units-on-board" option fails at plan time.
  const kernel = world().unit("riven", { might: 5 }).unit("ally").build();
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("riven"),
    controller: "A",
    timingPoint: "main-start"
  });

  assert.throws(
    () => buildCostPlan(context, { id: "cost:riven", cost: activated.cost }),
    (error) => error instanceof CostPlanError && error.reason === "invalid-cost-plan" &&
      /Cost requires an exact object reference/.test(error.message)
  );
});

test("rad-114-167 Riven, Deserter: the usage limit has no rules adapter and the filters cannot bind", () => {
  // CR 386/386.1: ActivatedAbility.restriction is descriptive data; nothing turns
  // the card's usage-limit into the Condition the merged chain Finalize checks.
  assert.throws(
    () => translateRestriction(activated.restriction, CANONICAL),
    (error) => error.code === "judge-required" &&
      /kind usage-limit needs a rules adapter/.test(error.message)
  );

  // CR 415.1: the object-exhausted trigger's exclude anchor is not in the merged
  // event-pattern vocabulary, and the body's object:"self" anchor is rejected too.
  assert.throws(
    () => translateTriggerFilter(exhaustTrigger.trigger.filter, "riven", "object-exhausted"),
    (error) => error.code === "judge-required" &&
      /Unsupported filter field exclude/.test(error.message)
  );
  assert.throws(
    () => translateInstructionTargets(exhaustTrigger.body),
    (error) => error.code === "judge-required" &&
      /Unsupported filter field object/.test(error.message)
  );
});

test("rad-114-167 Riven, Deserter: the interpreter honors both anchors, so only the production translation is missing", () => {
  // CR 415.1 / 355.9.b: "another friendly unit" is the board minus the source,
  // and "me" is the host. The reference interpreter's set query already
  // implements both anchors (355.9.b/359.3.h); the card is blocked by
  // programs/filters.ts, not by a missing ObjectSelector vocabulary.
  const kernel = world().player("A")
    .unit("riven", { might: 5, controller: "A" })
    .unit("ally", { controller: "A" })
    .unit("enemy", { controller: "B", owner: "B" })
    .build();
  const snapshot = kernel.getObject("riven");
  const scoped = kernel.clone({ sourceSnapshot: snapshot, host: snapshot.ref });
  const boardCount = (filter, expected) => {
    const outcome = runAbilityBody([{
      id: "riven.anchor",
      op: "condition.predicate",
      args: {
        condition: {
          kind: "constant",
          value: {
            kind: "compare",
            left: { kind: "count", subject: "objects", filter },
            operator: "eq",
            right: { kind: "constant", value: expected }
          }
        }
      }
    }], scoped);
    assert.equal(
      outcome.linkedValues["riven.anchor.value"],
      true,
      `${JSON.stringify(filter)} must select exactly ${expected} object(s)`
    );
  };

  // The host itself is never part of "another friendly unit".
  boardCount({ type: "unit", zone: "board", exclude: "source" }, 2);
  // "me"/self resolves to the host alone.
  boardCount({ type: "unit", object: "self" }, 1);
  // Control: an unanchored board query is the full three-unit board.
  boardCount({}, 3);
});

