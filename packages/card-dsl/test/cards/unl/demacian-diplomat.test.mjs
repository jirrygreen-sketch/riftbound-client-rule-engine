import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/demacian-diplomat.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-c727b18bcfb5615a8de8a65c546fa6fce2e4ce6fdb7c500d823fd9db1853ef50";
const SOURCE_TEXT = "When you play me, gain 1 XP.";

const [ability] = program.abilities;
const [gainXp] = ability.body;

test("unl-092-219 Demacian Diplomat: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-092-219 Demacian Diplomat: identity, status, no judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-092-219 Demacian Diplomat: one card-played trigger scoped to self", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a / 420.4.a: "When you play me" is the Play Effect at card-played.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("unl-092-219 Demacian Diplomat: the body is one unlinked gain of exactly 1 XP", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(gainXp.id, "demacian-diplomat.gain-xp");
  assert.equal(gainXp.op, "effect.xp");
  // 730.1: Gain XP increases the recipient's marked XP by the printed amount;
  // the implicit "you" is the ability controller (190.6.d), which is also
  // effect.xp's default recipient.
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
  assert.equal(gainXp.linkedTo, undefined);
  assert.equal(gainXp.condition, undefined);
});

test("unl-092-219 Demacian Diplomat golden: the body gains 1 XP through the chain adapter and reference kernel", () => {
  const kernel = world()
    .unit("diplomat", { zone: "board", location: { type: "base", player: "A" } })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("diplomat") });
  const outcome = resolveChainBody(ability.body, ctx);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["demacian-diplomat.gain-xp", "executed"]]
  );
  assert.equal(ctx.player("A").xp, 1);
  assert.equal(ctx.player("B").xp, 0);
  // 729.2: the XP total is public information; the receipt names the recipient.
  assert.equal(outcome.linkedValues["demacian-diplomat.gain-xp.gained"], 1);
  assert.equal(outcome.linkedValues["demacian-diplomat.gain-xp.gainedTo"], "A");
  assert.deepEqual(ctx.events.map(event => event.action), ["gain-xp"]);
});

test("unl-092-219 Demacian Diplomat golden: the recipient is the ability controller, not seat A", () => {
  const kernel = world()
    .unit("diplomat", { owner: "B", zone: "board", location: { type: "base", player: "B" } })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("diplomat"), controller: "B" });
  const outcome = resolveChainBody(ability.body, ctx);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["demacian-diplomat.gain-xp.gainedTo"], "B");
  assert.equal(ctx.player("B").xp, 1);
  assert.equal(ctx.player("A").xp, 0);
});

test("unl-092-219 Demacian Diplomat golden: a replaced gain negates the instruction without marking XP", () => {
  const kernel = world()
    .unit("diplomat", { zone: "board", location: { type: "base", player: "A" } })
    .build();
  kernel.addReplacement(action => (action.type === "gain-xp" ? "replaced" : null));
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("diplomat") });
  const outcome = resolveChainBody(ability.body, ctx);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]),
    [["demacian-diplomat.gain-xp", "negated", "replaced"]]
  );
  assert.equal(ctx.player("A").xp, 0);
});

test.todo(
  "unl-092-219 Demacian Diplomat: end-to-end card-played subscription through the chain " +
    "Pending/Finalize/Resolve flow and the 420.4.a play-effect ordering (CardProgram → trigger " +
    "registration, RIFT-120 follow-up)"
);
