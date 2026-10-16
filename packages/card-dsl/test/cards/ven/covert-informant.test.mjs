import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/covert-informant.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

test("covert-informant: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(
    program.canonicalCardId,
    "card.hash-a7852cd3cb51ac726ccf3fd549d64c739122b2160a5f283dd604718dda7c5bb6"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
      "[Empowered][>] When I move, draw 1."
  );
});

test("covert-informant: judgeReason names the missing Empower/Empowered expansions", () => {
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /RIFT-83\/84/);
  assert.match(program.judgeReason, /object-moved/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("covert-informant: Empower 3 is declared unexpanded", () => {
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "empower", value: 3 });
});

test("covert-informant: the move trigger is a mandatory object-moved trigger scoped to self", () => {
  const ability = program.abilities[1];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("covert-informant: the body is one unlinked effect.draw of exactly 1", () => {
  const ability = program.abilities[1];
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "covert-informant.draw");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("covert-informant: the body really draws 1 through the chain adapter", () => {
  const ability = program.abilities[1];
  const kernel = world().deck(["top", "next"]).build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(outcome.linkedValues["covert-informant.draw.drawn"], 1);
});

test.todo(
  "covert-informant: [Empower] 3 activation and the Empowered-state gate on 'When I move' " +
    "(827.1.c.1 cost.activated + effect.empower, 828.1.c dependent ability; RIFT-83/84)"
);
test.todo(
  "covert-informant: subscribe the object-moved trigger through the trigger pipeline and assert " +
    "the 421.1/449.1 move contract (CardProgram -> trigger/chain adapter, RIFT-120 follow-up)"
);
