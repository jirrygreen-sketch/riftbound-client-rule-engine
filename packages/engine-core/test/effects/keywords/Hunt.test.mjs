import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";

import hunt from "../../../dist/effects/keywords/Hunt.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../dist/chain/interpreter-adapter.js";
import { isTimingPointId } from "../../../dist/events/timing-points.js";
import { world } from "../../../dist/effects/testing/index.js";

const HOST = { canonicalCardId: "unl-117-219" };

function program(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Hunt 2]"
  };
}

function expanded(value) {
  return hunt.expand(value === undefined ? { host: HOST } : { host: HOST, value });
}

test("Hunt definition is valued, sums sources, and cites v1.5 823", () => {
  assert.equal(hunt.keyword, "Hunt");
  assert.equal(hunt.valued, true);
  assert.equal(hunt.stacking, "sum");
  for (const ref of ["823", "823.1", "823.1.a", "823.1.b", "823.1.c", "823.1.c.1", "823.1.c.2", "823.1.c.3", "823.2", "823.3"]) {
    assert.ok(hunt.ruleRefs.includes(ref), `missing ruleRef ${ref}`);
  }
});

test("Hunt expands to conquer and hold triggers with effect.xp", () => {
  const abilities = expanded(2);
  assert.equal(abilities.length, 2);
  assert.deepEqual(abilities.map(ability => ability.trigger.at), ["conquer", "hold"]);
  for (const ability of abilities) {
    assert.equal(ability.kind, "triggered");
    assert.equal(ability.optional, false);
    assert.ok(isTimingPointId(ability.trigger.at));
    assert.deepEqual(ability.trigger.filter, {
      event: ability.trigger.at,
      filter: { source: "self" }
    });
    assert.equal(ability.body.length, 1);
    assert.equal(ability.body[0].op, "effect.xp");
    assert.deepEqual(ability.body[0].args.amount, { kind: "constant", value: 2 });
  }
});

test("Hunt expansion passes validateCardProgram", () => {
  const result = validateCardProgram(program(expanded(2)));
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("Hunt omitting X uses the v1.5 default value of 1", () => {
  for (const ability of expanded()) {
    assert.deepEqual(ability.body[0].args.amount, { kind: "constant", value: 1 });
  }
});

test("Hunt preserves numeric boundaries, including zero and MAX_SAFE_INTEGER", () => {
  assert.deepEqual(expanded(0)[0].body[0].args.amount, { kind: "constant", value: 0 });
  assert.deepEqual(
    expanded(Number.MAX_SAFE_INTEGER)[1].body[0].args.amount,
    { kind: "constant", value: Number.MAX_SAFE_INTEGER }
  );
});

test("Hunt stacking is sum: a combined Hunt 1 + Hunt 2 expands as Hunt 3", () => {
  const combinedValue = 1 + 2;
  const abilities = expanded(combinedValue);
  assert.equal(hunt.stacking, "sum");
  assert.deepEqual(abilities[0].body[0].args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(abilities[1].body[0].args.amount, { kind: "constant", value: 3 });
  assert.equal(validateCardProgram(program(abilities)).ok, true);
});

test("Hunt conquer trigger body awards XP through the merged effect.xp primitive", () => {
  const kernel = world().unit("hunt-host", { zone: "board" }).build();
  const [conquer] = expanded(2);
  const outcome = resolveChainBody(conquer.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.player("A").xp, 2);
  assert.equal(outcome.results[0].result.linkedValues.gained, 2);
  assert.equal(outcome.results[0].result.linkedValues.gainedTo, "A");
});

test("Hunt hold trigger body awards its default XP to the host controller", () => {
  const base = world().unit("hunt-host", { owner: "B", controller: "B", zone: "board" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("hunt-host"), controller: "B" });
  const [, hold] = expanded();
  const outcome = resolveChainBody(hold.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("B").xp, 1);
  assert.equal(kernel.player("A").xp, 0);
});

test("Hunt is present in the generated keyword registry", () => {
  assert.equal(keywordDefinitionsById.get("Hunt"), hunt);
});
