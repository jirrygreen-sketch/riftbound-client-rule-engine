import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import showOff from "../../../dist/effects/keywords/ShowOff.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";

const HOST = Object.freeze({ canonicalCardId: "rad-082-167" });

function wrapProgram(abilities) {
  return {
    canonicalCardId: HOST.canonicalCardId,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "judge-required",
    judgeReason: "Show Off Finalize/cost.reveal consumer is pending.",
    abilities,
    sourceText: "[Show Off] a unit."
  };
}

function expansion(params) {
  return showOff.expand({ host: HOST, ...(params === undefined ? {} : { params }) });
}

test("Show Off declares the v1.5 keyword identity and rule coverage", () => {
  assert.equal(showOff.keyword, "Show Off");
  assert.equal(showOff.valued, false);
  assert.equal(showOff.stacking, "separate");
  for (const ref of ["832", "832.1", "832.1.b", "832.1.b.1", "832.1.c", "832.1.c.1", "832.1.c.2", "832.1.c.3", "832.1.c.4", "832.1.d", "832.1.d.1", "832.2", "832.2.a", "832.3"]) {
    assert.ok(showOff.ruleRefs.includes(ref), `missing rule ref ${ref}`);
  }
});

test("Show Off expands to one optional Finalize-time cost.reveal static ability", () => {
  const [ability] = expansion({ object: { type: "unit" }, instanceId: "show-off:unit" });
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "cost.reveal");
  assert.equal(ability.effect.instanceId, "show-off:unit");
  assert.equal(ability.effect.appliesTo, "self");
  assert.equal(ability.effect.chooser, "controller");
  assert.equal(ability.effect.timing, "chain-item-finalize");
  assert.equal(ability.effect.optional, true);
});

test("Show Off declares both legal object sources and their different actions", () => {
  const [ability] = expansion({ object: { type: "unit" } });
  assert.deepEqual(ability.effect.sources, ["hand", "board"]);
  assert.equal(ability.effect.handAction, "reveal");
  assert.equal(ability.effect.boardAction, "pick");
  assert.equal(ability.effect.object.type, "unit");
});

test("Show Off records Finalize snapshot locking and the objects-shown-off timing point", () => {
  const [ability] = expansion({ object: { type: "unit" }, instanceId: "instance-a" });
  assert.deepEqual(ability.effect.result, {
    kind: "show-off",
    instanceId: "instance-a",
    link: "show-off:instance-a",
    lockAt: "objects-shown-off",
    snapshot: true
  });
  assert.deepEqual(ability.effect.ruleRefs, showOff.ruleRefs);
});

test("Show Off expansion validates inside a minimal judge-required CardProgram", () => {
  const result = validateCardProgram(wrapProgram(expansion({ object: { type: "unit" } })));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.issues, []);
});

test("Show Off has no numeric value and ignores a stray value", () => {
  const withoutValue = showOff.expand({ host: HOST, params: { object: { type: "unit" } } });
  const withValue = showOff.expand({ host: HOST, value: 99, params: { object: { type: "unit" } } });
  assert.deepEqual(withValue, withoutValue);
});

test("Show Off preserves an omitted object as missing information instead of inventing a filter", () => {
  const [ability] = expansion();
  assert.equal(ability.effect.object, null);
  assert.equal(validateCardProgram(wrapProgram([ability])).ok, true);
});

test("Show Off instances remain separate and keep distinct linked results", () => {
  assert.equal(showOff.stacking, "separate");
  const first = expansion({ object: { type: "unit" }, instanceId: "instance-a" })[0];
  const second = expansion({ object: { type: "spell" }, instanceId: "instance-b" })[0];
  assert.notEqual(first.effect.instanceId, second.effect.instanceId);
  assert.notEqual(first.effect.result.link, second.effect.result.link);
  assert.equal(validateCardProgram(wrapProgram([first, second])).ok, true);
});

test("the generated keyword registry indexes Show Off under its printed spelling", () => {
  assert.equal(keywordDefinitionsById.get("Show Off"), showOff);
});
