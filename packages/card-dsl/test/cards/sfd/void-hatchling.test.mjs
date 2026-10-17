import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/void-hatchling.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const ID = "card.hash-4ab01377c65974a5fddcfffca25ef87c9b2148a25edc4b988270578e5b0c26a0";
const replacement = program.abilities[0];
const [look, optionalRecycle] = replacement.with;

test("sfd-018-221 Void Hatchling: validates identity and replacement structure", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /replacement/);
  assert.equal(program.sourceText, "If you would reveal cards from a deck, look at the top card first. You may recycle it. Then reveal those cards.");
});

test("sfd-018-221 Void Hatchling: looks at one ordered top-card pick before optional recycle", () => {
  assert.deepEqual(replacement.replaces, { event: "card-revealed", filter: { source: "self", zone: "deck" } });
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.picksSpecId, { kind: "constant", value: "void-hatchling.top-card" });
  assert.equal(optionalRecycle.op, "choice.optional");
  assert.equal(optionalRecycle.linkedTo, undefined);
  assert.equal(optionalRecycle.args.body.value[0].op, "effect.recycle");
});

test("sfd-018-221 Void Hatchling: inspect primitive returns the looked-at top card", () => {
  const kernel = world().deck("top").build();
  const args = {
    ...look.args,
    player: { kind: "constant", value: "A" }
  };
  const run = runInstruction(inspect, args, { world: kernel, picks: { "void-hatchling.top-card": [kernel.ref("top")] } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.looked, 1);
  assert.deepEqual(run.linked["looked-at"], [kernel.ref("top")]);
  assert.equal(kernel.getObject("top").zone, "deck");
});

test.todo("Void Hatchling: bind the replaced reveal's original card set and register the replacement before reveal resolution (RIFT-66/RIFT-120)");
