import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/salvage.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
// Production resolves a card body through the chain's interpreter adapter
// (chain/interpreter-adapter.ts), which keeps the card's Expr arguments inside
// one literal envelope so each merged primitive validates and evaluates them
// itself. The golden run uses that same path instead of hand-decoding args.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-75f34b26c92bf9cba4a9ba616b2a7988ef08395e860ed8c5269f15ea0ac6a850";

const play = program.abilities.find(ability => ability.kind === "play");
const choice = play.body[0];
const killInstruction = choice.args.body.value[0];
const drawInstruction = play.body[1];

const resultFor = (outcome, id) => outcome.results.find(result => result.id === id);

/** The top-level body locks its targets at Finalize, so pre-load the kernel. */
function castWith(kernel, { gearRef, tasked = true }) {
  kernel.setTargets("salvage-gear", gearRef === undefined ? [] : [gearRef]);
  kernel.setAnswers({ "salvage-kill-opt/optional": tasked });
  return resolveChainBody(play.body, kernel);
}

test("ogn-224-298 Salvage: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\nYou may kill a gear. Draw 1."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-224-298 Salvage structure: [Action], optional kill wrapped in its body, unlinked draw", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map(instruction => instruction.id), ["salvage-kill-opt", "salvage-draw"]);

  // Contract 3.9: the may wraps the chosen instruction inside body; there is no
  // separate choice instruction that the kill links back to.
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.prompt, { kind: "literal", value: "Kill a gear?" });
  assert.equal(choice.args.body.kind, "literal");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), ["salvage-kill"]);
  assert.equal(killInstruction.op, "effect.kill");
  assert.equal(killInstruction.linkedTo, undefined);
  assert.equal(killInstruction.targets, undefined);

  // 355.12: the gear is chosen (and locked with the spell) even though paying
  // the may-decision is optional, so the TargetSpec sits on the may node.
  assert.equal(choice.targets.length, 1);
  const target = choice.targets[0];
  assert.equal(target.id, "salvage-gear");
  assert.deepEqual(target.filter, { type: "gear" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(choice.picks, undefined);

  // "Draw 1." is a separate sentence: not linked, so it resolves even when the
  // kill is declined, negated or ignored (359.3.e.14).
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "literal", value: 1 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
});

test("ogn-224-298 Salvage golden: accepting the may kills the locked gear and then draws", () => {
  const kernel = world()
    .unit("battle-gear", { types: ["gear"], owner: "B" })
    .deck("top-card")
    .build();
  const gearRef = kernel.ref("battle-gear");

  const outcome = castWith(kernel, { gearRef, tasked: true });

  assert.equal(outcome.status, "executed");
  // Containers complete after their children, so the child kill is reported first.
  assert.deepEqual(
    outcome.results.map(result => result.id).sort(),
    ["salvage-draw", "salvage-kill", "salvage-kill-opt"]
  );
  assert.equal(resultFor(outcome, "salvage-kill-opt").result.status, "executed");
  assert.equal(resultFor(outcome, "salvage-kill").result.status, "executed");
  assert.equal(resultFor(outcome, "salvage-draw").result.status, "executed");
  assert.equal(kernel.getObject("battle-gear").zone, "trash");
  assert.deepEqual(kernel.events.map(event => event.action), ["kill", "draw"]);
  assert.equal(kernel.player("A").handSize, 1);
});

test("ogn-224-298 Salvage golden: declining the may skips the kill but still draws", () => {
  const kernel = world()
    .unit("kept-gear", { types: ["gear"], owner: "B" })
    .deck("top-card")
    .build();
  const gearRef = kernel.ref("kept-gear");

  const outcome = castWith(kernel, { gearRef, tasked: false });

  assert.deepEqual(outcome.results.map(result => result.id), ["salvage-kill-opt", "salvage-draw"]);
  assert.equal(resultFor(outcome, "salvage-kill-opt").result.status, "negated");
  assert.equal(resultFor(outcome, "salvage-kill-opt").result.reason, "skipped");
  assert.equal(kernel.getObject("kept-gear").zone, "board");
  assert.deepEqual(kernel.events.map(event => event.action), ["draw"]);
  assert.equal(kernel.player("A").handSize, 1);
});

test("ogn-224-298 Salvage golden: a lost target ignores the kill, the unlinked draw still resolves", () => {
  const kernel = world()
    .unit("leaving-gear", { types: ["gear"], owner: "B" })
    .deck("top-card")
    .build();
  const stale = kernel.ref("leaving-gear");
  // The gear left the Board after Finalize but before resolution (359.3.e).
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const outcome = castWith(kernel, { gearRef: stale, tasked: true });

  assert.equal(outcome.status, "partial");
  // The may-instruction is ignored before its body runs, so no kill child is
  // reported; the independent draw sentence still resolves (359.3.e.14).
  assert.deepEqual(outcome.results.map(result => result.id), ["salvage-kill-opt", "salvage-draw"]);
  assert.deepEqual(resultFor(outcome, "salvage-kill-opt").result, { status: "ignored", reason: "mistargeted" });
  assert.equal(resultFor(outcome, "salvage-draw").result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["move-zone", "draw"]);
});

test("ogn-224-298 Salvage golden: the merged kill primitive kills a gear on its own", () => {
  const kernel = world().unit("only-gear", { types: ["gear"], owner: "B" }).build();
  const run = runInstruction(
    kill,
    { target: "salvage-gear" },
    { world: kernel, targets: { "salvage-gear": [kernel.ref("only-gear")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
  assert.equal(kernel.getObject("only-gear").zone, "trash");
});

test.todo(
  "Salvage: Finalize-time target locking (355.8/355.12), the required-gear legality gate before " +
    "the spell can be played with the may declined, and became-target triggers belong to the " +
    "target/chain integration workstreams (RIFT-90 / RIFT-120)."
);
