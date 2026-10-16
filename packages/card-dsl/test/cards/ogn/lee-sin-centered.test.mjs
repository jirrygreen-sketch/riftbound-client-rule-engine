import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/lee-sin-centered.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { validateObjectFilter } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL = "card.hash-98fc18fcf30d6dd0b192f1c6ea251dd6a2e6d4a439098c533f77e58a2161074f";

test("ogn-151-298 Lee Sin, Centered: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
      "Other buffed friendly units at my battlefield have +2 :rb_might:."
  );
});

test("ogn-151-298 Lee Sin, Centered: printed power is null (no printed value) and is never rewritten to 0", () => {
  // The catalog carries power: null; the program has no cost block at all, so
  // nothing can turn the missing printed value into a 0 cost. This test pins
  // that shape for reviewers.
  assert.equal(Object.hasOwn(program, "cost"), false);
  assert.equal(program.abilities.some(ability => ability.kind === "play"), false);
  assert.equal(JSON.stringify(program).includes('"power":0'), false);
  assert.equal(JSON.stringify(program).includes('"power": 0'), false);
});

test("ogn-151-298 Lee Sin, Centered: judgeReason cites the layers consumer, the buffed predicate and the location anchor", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /buffed/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("ogn-151-298 Lee Sin, Centered: Accelerate is declared, the +2 Might aura is a static effect", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, aura] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "accelerate" });

  assert.equal(aura.kind, "static");
  assert.equal(aura.effect.kind, "continuous.might");
  assert.equal(aura.effect.mode, "add");
  assert.equal(aura.effect.layer, "arithmetic");
  assert.deepEqual(aura.effect.amount, { kind: "constant", value: 2 });
  // The aura reads the host's current location and the buffed state; neither is
  // an executable filter today (judgeReason). The selectors are the contract 3.6
  // symbolic forms.
  assert.deepEqual(aura.effect.filter, {
    type: "unit",
    controller: "controller",
    exclude: "self",
    sameLocationAs: "source",
    buffed: true
  });
  assert.equal(aura.condition, undefined);
});

test("ogn-151-298 Lee Sin, Centered: the engine's filter vocabulary has no 'buffed' state (702/703)", () => {
  // CR v1.5 702/703 make Buffs counters; the engine's ObjectState vocabulary is
  // the closed set used by the trigger/filter validator. "buffed" is therefore a
  // descriptive placeholder on the aura, not an executable state.
  const accepted = validateObjectFilter({ type: "unit", states: "exhausted" });
  assert.equal(accepted.ok, true, JSON.stringify(accepted.issues));
  const rejected = validateObjectFilter({ type: "unit", states: "buffed" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.issues.some(issue => issue.code === "invalid-object-state"), true);
  assert.deepEqual(Object.keys(program.abilities[1].effect.filter), [
    "type",
    "controller",
    "exclude",
    "sameLocationAs",
    "buffed"
  ]);
});

test.todo(
  "ogn-151-298 Lee Sin, Centered: 'Other buffed friendly units at my battlefield have +2 Might.' needs the " +
    "layers consumer for a static continuous.might effect registered from a card program (CR v1.5 364/703; " +
    "contract 3.4 arithmetic layer, RIFT-91 workstream) plus a buffed predicate and a host-location " +
    "('my battlefield') anchor."
);
