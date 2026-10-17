// RIFT-680: layer-1/2 checks (validation, identity, structure). Layer-3 real
// execution evidence (trigger pipeline row: placeholder gap = no draw beside
// a friend) lives in the parameterized template suite:
// test/cards/templates/keyword-triggered-object-killed-effect-d-680.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/loyal-poro.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL_ID =
  "card.hash-189fb540b58840dbea672bf530705d9fc1548c9fb015ca1b98912e7e4bff7fc1";
const SOURCE_TEXT =
  "[Deathknell][>] If I didn't die alone, draw 1. (When I die, get the effect. " +
  "I wasn't alone if there were other friendly units here.)";

const [deathknellKeyword, diesTrigger] = program.abilities;
const [drawInstruction] = diesTrigger.body;

test("unl-156-219 Loyal Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-156-219 Loyal Poro: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /740\.2\.a/);
  assert.match(program.judgeReason, /808\.1\.c\.2/);
  assert.match(program.judgeReason, /object-killed|trigger.leave/);
  // Re-checked against the merged sources: the trigger condition registers, and
  // the remaining gap is the un-normalized controller placeholder plus the
  // unregistered trigger.leave op.
  assert.match(program.judgeReason, /Unregistered instruction opcode/);
  assert.match(program.judgeReason, /归一化/);
  assert.doesNotMatch(program.judgeReason, /已合入 host 都不提供/);
});

test("unl-156-219 Loyal Poro: [Deathknell] is declared, not re-implemented (contract 3.7)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deathknellKeyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknellKeyword.value, undefined);
  const registered = keywordDefinitionsById.get("Deathknell");
  assert.ok(registered, "effects/keywords/Deathknell.ts must be in the generated registry");
  assert.equal(deathknellKeyword.keyword, registered.keyword.toLowerCase());
  // 808.2 / 808.2.a：同一永久物上的每个 Deathknell 实例各自独立触发。
  assert.equal(registered.stacking, "separate");
});

test("unl-156-219 Loyal Poro: the printed [Effect] rides an object-killed trigger (CR 808.1.c)", () => {
  assert.equal(diesTrigger.kind, "triggered");
  assert.equal(diesTrigger.trigger.at, "object-killed");
  assert.deepEqual(diesTrigger.trigger.filter, { self: true });
  assert.equal(diesTrigger.optional, false);
  assert.equal(diesTrigger.trigger.once, undefined);
});

test("unl-156-219 Loyal Poro: \"didn't die alone\" is a pre-chain condition on the source's location", () => {
  // 808.1.c.2：过去式 Effect 指触发进链那一刻的状态，因此检查是触发条件，不是效果的一部分；
  // 740.2.a：同一位置上有其他友方单位时不是 alone（本卡是它的否定形）。
  const condition = diesTrigger.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "objects");
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    sameLocationAs: "source",
    exclude: "source"
  });
});

test("unl-156-219 Loyal Poro: the effect body draws exactly 1 with a single unlinked instruction", () => {
  assert.equal(diesTrigger.body.length, 1);
  assert.equal(drawInstruction.id, "loyal-poro.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("unl-156-219 Loyal Poro golden: the object-killed CardProgram trigger registers through the merged binding", () => {
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const board = fixture({
    cards: [{ id: "poro", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: [], might: 3 }]
  });
  const source = { ...board.kernel.getObject("poro"), cardId: CANONICAL_ID, zone: "board" };
  const ids = binding.registerProgramTriggers(board.engine, source);
  assert.equal(ids.length, 2);
  assert.match(ids[0], /^program:poro:1:/);
});

test("unl-156-219 Loyal Poro: the registered condition still cannot see a friendly unit here (808.1.c.2 / 740.2.a)", () => {
  // The condition now rides the registration, but its controller placeholder is
  // not normalized: the reference kernel and the pipeline's
  // evaluateTriggerCondition both compare it literally, so the same-location
  // count falls to zero and the condition is false even with a friendly unit
  // present. Substituting a literal player id is what makes it true.
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const board = fixture({
    cards: [
      { id: "poro", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: [], might: 3 },
      { id: "friend", types: ["unit"], owner: "A", controller: "A", might: 2 }
    ]
  });
  for (const id of ["poro", "friend"]) {
    board.engine.commit({
      type: "move-zone",
      object: board.kernel.ref(id),
      to: "board",
      location: { type: "battlefield", id: "bf-1" }
    });
  }
  const source = { ...board.kernel.getObject("poro"), cardId: CANONICAL_ID, zone: "board" };
  binding.registerProgramTriggers(board.engine, source);
  const registrations = [...board.engine.pipeline.triggers.values()]
    .filter((registration) => registration.source.ref.id === "poro");
  assert.equal(registrations.length, 2);
  const conditioned = registrations.find((registration) => registration.spec.condition !== undefined);
  assert.ok(conditioned, "the 'didn't die alone' clause must be registered as a trigger condition");
  assert.deepEqual(conditioned.spec.condition.left.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    sameLocationAs: "source",
    exclude: "source"
  });
  // The friendly unit really is here. The anchored set query (the one the
  // interpreter uses for sameLocationAs/exclude) returns it, so the false
  // result below can only come from the un-normalized controller placeholder.
  // The ability's own ResolveContext is rebased on the dying host, exactly as
  // the trigger scan rebuilds it before evaluating the condition.
  const scoped = board.host.context(board.kernel.getObject("poro"), "A", "object-killed");
  const environment = {
    context: scoped,
    host: board.kernel.ref("poro"),
    linked: (key) => scoped.linked(key),
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.deepEqual(
    queryObjects(conditioned.spec.condition.left.filter, environment).map((object) => object.ref.id),
    []
  );
  const anchored = structuredClone(conditioned.spec.condition.left.filter);
  anchored.controller = "A";
  assert.deepEqual(
    queryObjects(anchored, environment).map((object) => object.ref.id),
    ["friend"]
  );
  assert.equal(evaluateCondition(conditioned.spec.condition, environment), false);
  const literal = structuredClone(conditioned.spec.condition);
  literal.left.filter.controller = "A";
  assert.equal(evaluateCondition(literal, environment), true, "a literal player id resolves the count");
});

test("unl-156-219 Loyal Poro: the [Deathknell] expansion body still references the unregistered trigger.leave op (808.1.d)", () => {
  assert.equal(instructionDefinitionsById.has("trigger.leave"), false);
  const definition = keywordDefinitionsById.get("Deathknell");
  const [expansion] = definition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  const kernel = world().unit("poro", { owner: "A", controller: "A" }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("poro"), controller: "A" });
  assert.throws(
    () => resolveChainBody(expansion.body, scoped),
    /Unregistered instruction opcode: trigger\.leave/
  );
});

test.todo(
  "unl-156-219 Loyal Poro: expand [Deathknell] (subscribe object-killed, removal from the chain when " +
    "the death is replaced per 808.1.d.1, last-known information recorded pre-chain per 808.1.d.3) — " +
    "the registered KeywordDef still references the unregistered trigger.leave op"
);
test.todo(
  "unl-156-219 Loyal Poro: normalize the 'controller' player placeholder so the registered condition sees " +
    "same-location friendly units, and evaluate it against the source's last-known location before the " +
    "trigger is queued (CR 740.2.a, 808.1.c.2, 808.1.d.3)"
);
