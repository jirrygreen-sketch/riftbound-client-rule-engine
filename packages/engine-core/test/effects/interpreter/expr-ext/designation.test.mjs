import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExtendedExpression } from "../../../../dist/effects/interpreter/expr-ext/index.js";
import { MissingInformation } from "../../../../dist/effects/interpreter/values.js";
import { world } from "../../../../dist/effects/testing/index.js";
import { environment } from "./helpers.mjs";

for (const role of ["attacker", "defender", null, undefined]) {
  test(`designation reads combatRole ${String(role)} in native and existing property spellings`, () => {
    const kernel = world().unit("source", role === undefined ? {} : { combatRole: role }).build();
    for (const expr of [
      { kind: "object-designation", object: "self" },
      { kind: "object-property", object: "self", property: "designation" },
      { kind: "object-attribute", object: "self", attribute: "designation" }
    ]) assert.equal(evaluateExtendedExpression(expr, environment(kernel)), role ?? null);
  });
}

test("designation preserves host/source and exact target/pick identities", () => {
  const kernel = world().unit("source", { combatRole: "attacker" }).unit("host", { combatRole: "defender" }).build();
  const context = kernel.clone({ source: kernel.ref("source"), sourceSnapshot: kernel.getObject("source") });
  context.setTargets("unit", [context.ref("host")]);
  context.setPicks("unit", [context.ref("host")]);
  const env = environment(context, { host: context.ref("host") });
  for (const object of ["self", { target: "unit" }, { pick: "unit" }]) {
    assert.equal(evaluateExtendedExpression({ kind: "object-designation", object }, env), "defender");
  }
  assert.equal(evaluateExtendedExpression({ kind: "object-designation", object: "source" }, env), "attacker");
  assert.equal(context.perform({ type: "kill", object: context.ref("host") }).status, "done");
  assert.throws(() => evaluateExtendedExpression({ kind: "object-designation", object: { target: "unit" } }, env), MissingInformation);
});

test("source designation uses supplied last-known information after leaving its zone", () => {
  const kernel = world().unit("source", { combatRole: "attacker" }).build();
  const context = kernel.clone({ source: kernel.ref("source"), sourceSnapshot: kernel.getObject("source") });
  assert.equal(context.perform({ type: "kill", object: context.ref("source") }).status, "done");
  assert.equal(evaluateExtendedExpression({ kind: "object-designation", object: "source" }, environment(context)), "attacker");
});

test("designation does not guess from location, controller, or exhaustion", () => {
  const kernel = world().unit("source", { exhausted: true }).build();
  assert.equal(evaluateExtendedExpression({ kind: "object-designation", object: "self" }, environment(kernel)), null);
});
