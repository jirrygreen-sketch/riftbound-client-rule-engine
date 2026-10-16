import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/undertitan.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
// The chain's interpreter adapter preserves the primitive argument Exprs, the
// same way the merged chain engine invokes card-program bodies.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL = "card.hash-722d071685a6b301064e318e0f8ac8683e616a934d89658bf00fb0fedca48f5a";
const [playTrigger, revealReplacement] = program.abilities;
const [mightInstruction] = playTrigger.body;
const [addInstruction] = revealReplacement.with;

test("sfd-175-221 Undertitan: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /135\.2\.b\.6/);
  assert.equal(
    program.sourceText,
    "When you play me, give your other units +2 :rb_might: this turn.\n" +
      "As I'm revealed from your deck, [Add] :rb_energy_2:."
  );
});

test("sfd-175-221 Undertitan: play trigger declares a temporary Might grant on other friendly units", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(mightInstruction.id, "undertitan.grant-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "end-of-turn" });
  // 355.10.d: "your other units" is a characteristic-based set, not a target
  // choice; "other" excludes the source (355.9.c).
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: { zone: "board", type: "unit", controller: "controller", other: true }
    }
  });
  assert.equal(mightInstruction.targets, undefined);
});

test("sfd-175-221 Undertitan: the reveal clause is a replacement adding 2 Energy", () => {
  // 135.2.b.6 uses this exact clause as its example of text that is not an
  // instruction; 369.1 names Undertitan as the reveal replacement example.
  assert.equal(revealReplacement.kind, "replacement");
  assert.deepEqual(revealReplacement.replaces, {
    event: "card-revealed",
    filter: { source: "self", zone: "deck" }
  });
  assert.equal(addInstruction.id, "undertitan.add-energy-2");
  assert.equal(addInstruction.op, "effect.resources");
  assert.deepEqual(addInstruction.args.energy, { kind: "constant", value: 2 });
  assert.deepEqual(addInstruction.args.linkKey, { kind: "constant", value: "resources" });
  assert.equal(addInstruction.linkedTo, undefined);
});

test("sfd-175-221 Undertitan: the merged Add primitive puts the 2 Energy in the Rune Pool", () => {
  // 430.1 / 166.1: adding Energy puts it into the controller's Rune Pool. The
  // replacement registration around the reveal is the judged half.
  const kernel = world().player("A").build();
  const run = runInstruction(
    resources,
    { energy: { kind: "constant", value: 2 }, linkKey: { kind: "constant", value: "resources" } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.resources, { player: "A", energy: 2, power: [] });
  assert.equal(kernel.player("A").energy, 2);
});

test("sfd-175-221 Undertitan: the body executes through the interpreter with explicit source context", () => {
  const kernel = world()
    .player("A")
    .unit("undertitan", { zone: "board", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("undertitan") });
  const outcome = resolveChainBody([addInstruction], scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.player("A").energy, 2);
});

test.todo(
  "sfd-175-221 Undertitan: apply the +2 Might to other friendly units for the rest of the turn through a " +
    "registered continuous.might effect with an end-of-turn duration (RIFT-91 follow-up: no instruction " +
    "primitive registers one and no consumer reads a card static amount)"
);

test.todo(
  "sfd-175-221 Undertitan: register the reveal replacement and observe 'revealed from your deck' " +
    "(135.2.b.6 / 369.1; the event pipeline registers replacements as action matchers only, and card " +
    "replacement registration is not wired — engine batch 4/5)"
);
