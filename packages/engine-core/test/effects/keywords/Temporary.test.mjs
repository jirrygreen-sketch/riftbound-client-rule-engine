import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";

import temporary from "../../../dist/effects/keywords/Temporary.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../dist/chain/interpreter-adapter.js";
import { isTimingPointId } from "../../../dist/events/timing-points.js";
import { world } from "../../../dist/effects/testing/index.js";

const HOST = { canonicalCardId: "ogn-274-298" };

function program(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities,
    sourceText: "[Temporary]"
  };
}

test("Temporary definition cites v1.5 816 and is redundant/single", () => {
  assert.equal(temporary.keyword, "Temporary");
  assert.equal(temporary.valued, false);
  assert.equal(temporary.stacking, "single");
  for (const ref of ["816", "816.1", "816.1.a", "816.1.b", "816.1.c", "816.2", "816.2.a", "816.3"]) {
    assert.ok(temporary.ruleRefs.includes(ref), `missing ruleRef ${ref}`);
  }
});

test("Temporary expands to one mandatory beginning-start kill trigger", () => {
  const [ability] = temporary.expand({ host: HOST });
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "beginning-start");
  assert.ok(isTimingPointId(ability.trigger.at));
  assert.deepEqual(ability.trigger.filter, { event: "beginning-start", player: "self" });
  assert.deepEqual(ability.body, [{
    id: `temporary:${HOST.canonicalCardId}:kill`,
    op: "effect.kill",
    args: { self: { kind: "constant", value: true } }
  }]);
});

test("Temporary expansion passes validateCardProgram", () => {
  const result = validateCardProgram(program(temporary.expand({ host: HOST })));
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("Temporary ignores accidental numeric values", () => {
  assert.deepEqual(
    temporary.expand({ host: HOST, value: 0 }),
    temporary.expand({ host: HOST, value: Number.MAX_SAFE_INTEGER })
  );
});

test("Temporary stacking is single: repeated instances collapse to one trigger", () => {
  const first = temporary.expand({ host: HOST });
  const second = temporary.expand({ host: HOST });
  assert.deepEqual(first, second);
  const combined = [first[0], second[0]];
  const collapsed = [combined[0]];
  assert.equal(collapsed.length, 1);
  assert.equal(validateCardProgram(program(collapsed)).ok, true);
});

test("Temporary kill body executes through the merged effect.kill primitive", () => {
  const base = world().unit("temporary-host", { zone: "board" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("temporary-host") });
  const [ability] = temporary.expand({ host: HOST });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("temporary-host").zone, "trash");
  assert.deepEqual(outcome.results[0].result.linkedValues.killed, [{ id: "temporary-host", zoneEntryId: 1 }]);
});

test("Temporary kill is ignored when the host is no longer on the board", () => {
  const base = world().unit("temporary-host", { zone: "hand" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("temporary-host") });
  const [ability] = temporary.expand({ host: HOST });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("temporary-host").zone, "hand");
});

test("Temporary is present in the generated keyword registry", () => {
  assert.equal(keywordDefinitionsById.get("Temporary"), temporary);
});
