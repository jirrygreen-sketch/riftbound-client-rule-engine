import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/void-hatchling.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
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
  assert.match(program.judgeReason, /picksSpecId/);
  assert.match(program.judgeReason, /原 reveal 请求/);
  assert.match(program.judgeReason, /replacement/);
  assert.equal(program.sourceText, "If you would reveal cards from a deck, look at the top card first. You may recycle it. Then reveal those cards.");
});

test("sfd-018-221 Void Hatchling: looks at one ordered top-card pick before optional recycle", () => {
  assert.deepEqual(replacement.replaces, { event: "card-revealed", player: "self", filter: { zone: "deck" } });
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(look.args.picksSpecId, { kind: "constant", value: "void-hatchling.top-card" });
  assert.equal(optionalRecycle.op, "choice.optional");
  assert.equal(optionalRecycle.linkedTo, undefined);
  assert.equal(optionalRecycle.args.body.value[0].op, "effect.recycle");
});

test("sfd-018-221 Void Hatchling: inspect primitive returns the looked-at top card", () => {
  const base = world().unit("hatchling", { cardId: ID }).deck("top").build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("hatchling") });
  const top = kernel.zoneSlice("A", "deck", "top", 1).map(object => object.ref);
  const run = runInstruction(inspect, { ...look.args, player: { kind: "constant", value: kernel.evaluate(look.args.player) } }, { world: kernel, picks: { "void-hatchling.top-card": top } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.looked, 1);
  assert.deepEqual(run.linked["looked-at"], [kernel.ref("top")]);
  assert.equal(kernel.getObject("top").zone, "deck");
});

test("Void Hatchling supported primitives: recycle the actual card returned by inspect", () => {
  const base = world().unit("hatchling", { cardId: ID }).deck(["top", "next"]).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("hatchling") });
  // Primitive-only evidence: derive the viewer from the real source snapshot.
  // The production inspect schema still needs symbolic source support; this
  // does not claim the replacement body or its optional decision is executable.
  const inspected = runInstruction(inspect, {
    ...look.args, player: { kind: "constant", value: kernel.evaluate(look.args.player) }
  }, { world: kernel, picks: { "void-hatchling.top-card": kernel.zoneSlice("A", "deck", "top", 1).map(object => object.ref) } });
  assert.equal(inspected.result.status, "executed");
  const instruction = optionalRecycle.args.body.value[0];
  const recycled = runInstruction(recycle, instruction.args, { world: kernel });
  assert.equal(recycled.result.status, "executed");
  assert.equal(recycled.linked.recycledCount, 1);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["next", "top"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "recycle"]);
});

test.todo("Void Hatchling: bind the whole reveal request, original deck owner, initiating player and inspect symbolic source; provide the ordered top-card pick to the replacement, then resume the request");
