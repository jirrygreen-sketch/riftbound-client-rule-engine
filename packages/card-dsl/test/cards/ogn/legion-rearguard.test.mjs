import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/legion-rearguard.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import effectReady from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-a276ed720995bb4d684f3f838182e4271ea398c1cac8f48837c9e7c292cd0497";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)";

test("ogn-010-298 Legion Rearguard: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-010-298 Legion Rearguard: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-010-298 Legion Rearguard: judgeReason names the missing wiring and its tasks", () => {
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /805\.1\.b\.1/);
  assert.match(program.judgeReason, /keyword 能力接进打出流程/);
  assert.match(program.judgeReason, /不属于本卡 write scope/);
});

test("ogn-010-298 Legion Rearguard: exactly one unvalued Accelerate keyword ability", () => {
  assert.equal(program.abilities.length, 1);
  const [keyword] = program.abilities;
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "accelerate");
  assert.equal(keyword.value, undefined);
});

test("ogn-010-298 Legion Rearguard: the declared keyword id matches the registered KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Accelerate");
  assert.ok(registered, "effects/keywords/Accelerate.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.ok(registered.ruleRefs.includes("805.1.b"));
});

test("ogn-010-298 Legion Rearguard: the merged Accelerate enter-ready body readies the unit (CR 805.6)", () => {
  const host = { canonicalCardId: program.canonicalCardId };
  const [, replacement] = accelerate.expand({ host });
  const enterReady = replacement.with[0];
  assert.equal(enterReady.op, "effect.ready");

  const base = world().unit("legion-rearguard", { exhausted: true, might: 2, types: ["unit"] }).build();
  const bound = base.clone({ sourceSnapshot: undefined, source: base.ref("legion-rearguard") });
  const run = runInstruction(effectReady, enterReady.args, { world: bound });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["ready"]);
  assert.equal(bound.getObject("legion-rearguard").exhausted, false);
});

test.todo(
  "Legion Rearguard: pay [1][Fury] as an optional additional cost while playing me, then enter ready "
    + "through the delayed replacement (CR 805.1.b/805.2.b/805.6) — blocked because no producer turns "
    + "the card's keyword ability into an optionalAdditional accelerate component or registers the "
    + "accelerate.cost / enter-ready replacement for it"
);
