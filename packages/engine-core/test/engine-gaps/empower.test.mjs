import assert from "node:assert/strict";
import test from "node:test";

import empower from "../../dist/effects/instructions/effect.empower.js";
import {
  disempowerTransition,
  empowerTransition,
  empoweredState,
  isEmpowered,
  readEmpowered
} from "../../dist/zones/empower-state.js";
import {
  empoweredCount,
  evaluateEmpowered
} from "../../dist/effects/interpreter/predicates/empowered.js";
import { runInstruction, world } from "../../dist/effects/testing/index.js";
import { runCardScenario } from "../../dist/effects/testing/scenario/index.js";

const c = value => ({ kind: "constant", value });
const source = c({ kind: "source" });

function predicateContext(kernel, host = "source") {
  return {
    context: kernel,
    host: kernel.ref(host),
    linked: key => kernel.linked(key),
    canLookBack: () => false,
    isIgnored: () => false
  };
}

test("Empowered state transitions preserve binary, stacking, cap, and one-status Disempower rules", () => {
  assert.deepEqual(empowerTransition({ empowered: 0 }, { amount: 1 }), {
    previousCount: 0, currentCount: 1, appliedAmount: 1, changed: true
  });
  assert.deepEqual(empowerTransition({ empowered: 1 }, { amount: 1 }), {
    previousCount: 1, currentCount: 1, appliedAmount: 0, changed: false,
    reason: "already-empowered"
  });
  assert.deepEqual(empowerTransition({ empowered: 2 }, { amount: 2, multiple: true, limit: 3 }), {
    previousCount: 2, currentCount: 3, appliedAmount: 1, changed: true
  });
  assert.deepEqual(empowerTransition({ empowered: 3 }, { amount: 1, multiple: true, limit: 3 }), {
    previousCount: 3, currentCount: 3, appliedAmount: 0, changed: false,
    reason: "limit-reached"
  });
  assert.deepEqual(disempowerTransition({ empowered: 2 }), {
    previousCount: 2, currentCount: 1, appliedAmount: 1, changed: true
  });
  assert.deepEqual(disempowerTransition({ empowered: 0 }), {
    previousCount: 0, currentCount: 0, appliedAmount: 0, changed: false,
    reason: "not-empowered"
  });
  assert.throws(() => empowerTransition({ buffs: 1 }, { amount: 1 }), /Empowered state is unavailable/);
  assert.deepEqual(empoweredState(2), { empowered: 2, empoweredCount: 2 });
});

test("the Empowered predicate reads the same live count used by the action gate", () => {
  const kernel = world().unit("source").build();
  const context = predicateContext(kernel);
  assert.equal(evaluateEmpowered({ object: "self" }, context), false);
  assert.equal(evaluateEmpowered({ object: "self", expected: false }, context), true);

  kernel.perform({ type: "empower", object: kernel.ref("source") });
  assert.equal(readEmpowered(kernel.getObject("source")), 1);
  assert.equal(isEmpowered(kernel.getObject("source")), true);
  assert.equal(evaluateEmpowered({ object: "self" }, predicateContext(kernel)), true);
  assert.equal(evaluateEmpowered({ object: "self", operator: "gte", right: c(2) }, predicateContext(kernel)), false);
  assert.equal(empoweredCount(context), 1);
  assert.equal(empoweredCount(predicateContext(kernel)), 1);
});

test("effect.empower rechecks a binary status at resolve and submits no redundant action", () => {
  const kernel = world().unit("source").build();
  const first = runInstruction(empower, { objects: source }, { world: kernel });
  const second = runInstruction(empower, { objects: source }, { world: kernel });

  assert.equal(first.result.status, "executed");
  assert.equal(first.events.length, 1);
  assert.equal(second.result.status, "executed");
  assert.deepEqual(second.events, []);
  assert.equal(second.linked.empowered.count, 0);
  assert.equal(kernel.getObject("source").empowered, 1);
});

test("effect.empower applies a multi-Empower cap without overshooting it", () => {
  const kernel = world().unit("source").build();
  const args = { objects: source, multiple: c(true), limit: c(2) };
  runInstruction(empower, args, { world: kernel });
  runInstruction(empower, args, { world: kernel });
  const capped = runInstruction(empower, args, { world: kernel });

  assert.equal(kernel.getObject("source").empowered, 2);
  assert.equal(capped.result.status, "executed");
  assert.deepEqual(capped.events, []);
  assert.equal(capped.linked.empowered.count, 0);
});

test("a representative raw Empower IR reaches the default Chain assembly", () => {
  const program = {
    canonicalCardId: "test:raw-empower",
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "Empower me.",
    abilities: [{
      kind: "activated",
      timing: "action",
      cost: { kind: "activated", energy: c(0) },
      body: [{ id: "raw-empower", op: "effect.empower", args: { objects: source } }]
    }]
  };
  const result = runCardScenario(program, {
    players: { A: { energy: 0 }, B: { energy: 0 } },
    objects: [{
      id: "source",
      program,
      cardId: program.canonicalCardId,
      zone: "board",
      types: ["unit"],
      location: { type: "base", player: "A" },
      energy: null,
      power: null,
      might: 3
    }],
    operations: [
      { type: "activate", object: "source", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ],
    expect: { objects: { source: { empowered: 1 } } }
  });
  result.asserts();
  assert.ok(result.events.some(event => event.timingPoint === "empowered-changed"));
});
