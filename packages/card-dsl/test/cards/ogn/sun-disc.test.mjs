import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/sun-disc.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";

const CANONICAL = "card.hash-b655d62fccecd79b856fc6c566229fc081413d7272a86745524d464c047c9356";

const [activated] = program.abilities;
const body = activated.body;
const [nextUnitReady] = body;

test("ogn-021-298 Sun Disc: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /registerDelayedTrigger/);
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /812\.1\.c/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: [Legion] — The next unit you play this turn enters ready. " +
      "(Get the effect if you've played another card this turn.)"
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Sun Disc structure: exhaust-cost action ability gated by the Legion condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.equal(activated.cost.kind, "activated");
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust" }]);
  assert.equal(activated.restriction, undefined);

  assert.equal(body.length, 1);
  assert.equal(nextUnitReady.id, "sun-disc.next-unit-ready");
  assert.equal(nextUnitReady.op, "replacement.enter");
  assert.deepEqual(nextUnitReady.args.state, { kind: "constant", value: "ready" });
  assert.deepEqual(nextUnitReady.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(nextUnitReady.args.appliesTo, {
    kind: "constant",
    value: "next-unit-you-play"
  });
  assert.equal(nextUnitReady.linkedTo, undefined);

  // “[Legion] —” gates this ability: another card must have been played this turn
  // (CR v1.5 812.1.b.1 / 812.1.c), and the count must exclude the host itself.
  assert.deepEqual(nextUnitReady.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-finalized-this-turn",
      filter: { player: "controller", exclude: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("Sun Disc golden: the exhaust cost is payable and exhausts the Gear itself", () => {
  const base = world()
    .unit("sun-disc", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("sun-disc") });
  const plan = buildCostPlan(kernel, {
    id: "cost:sun-disc",
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] }
  });
  assert.equal(plan.total.actions.length, 1);
  assert.equal(plan.total.actions[0].action.type, "exhaust");
  assert.deepEqual(plan.total.actions[0].action.object, kernel.ref("sun-disc"));

  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("sun-disc").exhausted, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
});

test("Sun Disc golden: an already-exhausted Gear cannot pay the activation cost", () => {
  const base = world()
    .unit("sun-disc", {
      types: ["gear"],
      zone: "board",
      exhausted: true,
      location: { type: "base", player: "A" }
    })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("sun-disc") });
  const plan = buildCostPlan(kernel, {
    id: "cost:sun-disc",
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] }
  });
  assert.throws(
    () => payCostPlan(kernel, plan),
    error => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
});

test.todo(
  "Sun Disc: “The next unit you play this turn enters ready.” needs the delayed entry " +
    "replacement (CR v1.5 392 delayed passive ability, 143.4 / 359.2.c unit entry state, " +
    "805.6 ready-entry replacement). ResolveContext.registerDelayedTrigger is declared but no " +
    "merged instruction primitive registers one; RIFT-260's replacement.enter handles entry " +
    "moves already registered on the event pipeline, and bindReplacement consumes only a " +
    "body-embedded with clause, so there is no 'next unit you play' window for card data " +
    "(RIFT-257 program binding is also pending)."
);

test.todo(
  "Sun Disc: the Legion condition (CR v1.5 812.1.c “a card different than the one with the " +
    "Legion ability”) needs a history query that excludes the host by card identity; the merged " +
    "HistoryQuery carries only scope/action/timingPoint/player/object (contract 3.8's " +
    "exclude/objectFilter are not landed)."
);
