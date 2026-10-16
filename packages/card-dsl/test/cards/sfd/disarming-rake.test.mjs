import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/disarming-rake.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-89e550302d0740c3eda7dbbeed7a733ed73710ce218d8bbcbd8ed3a58710e810";
const TARGET_ID = "disarming-rake.gear";

const [ability] = program.abilities;
const [choice] = ability.body;
const [killInstruction] = choice.args.body.value;

const resultFor = (outcome, id) => outcome.results.find(result => result.id === id);

/** The may node locks its target at Finalize, so pre-load the kernel. */
function resolveWith(kernel, { gearRef, accepted }) {
  kernel.setTargets(TARGET_ID, gearRef === undefined ? [] : [gearRef]);
  kernel.setAnswers({ "disarming-rake.may-kill-gear/optional": accepted });
  return resolveChainBody(ability.body, kernel);
}

test("sfd-032-221 Disarming Rake: program validates and is registered as executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "When you play me, you may kill a gear.");
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-032-221 Disarming Rake: card-played self trigger whose whole body is the may-kill", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.a / 420.4.a: "When you play me" fires once the play action completes.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 403.1: the printed "you may" is the instruction's optional wrapper, not a
  // separate trigger-level decision, so the ability itself is mandatory.
  assert.equal(ability.optional, false);
});

test("sfd-032-221 Disarming Rake: contract 3.9 may-shape wraps the kill inside choice.optional", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["disarming-rake.may-kill-gear"]);
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.prompt, { kind: "constant", value: "Kill a gear?" });
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), ["disarming-rake.kill-gear"]);

  // 355.7 / 355.12: "a gear" is chosen, so it is a target and the TargetSpec sits
  // on the may node so every choice for the may-action is locked with the play.
  assert.equal(choice.targets.length, 1);
  const [target] = choice.targets;
  assert.equal(target.id, TARGET_ID);
  assert.deepEqual(target.filter, { type: "gear" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(choice.picks, undefined);

  // The kill body carries no target of its own and does not link back to the
  // choice node (contract 3.9 forbids choice + linkedTo).
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args, { target: { kind: "constant", value: TARGET_ID } });
  assert.equal(killInstruction.linkedTo, undefined);
  assert.equal(killInstruction.targets, undefined);
});

test("sfd-032-221 Disarming Rake golden: accepting the may kills the locked gear (CR 429)", () => {
  const kernel = world()
    .unit("rake", { might: 2 })
    .unit("enemy-gear", { types: ["gear"], owner: "B" })
    .build();
  const outcome = resolveWith(kernel, { gearRef: kernel.ref("enemy-gear"), accepted: true });

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => entry.id).sort(),
    ["disarming-rake.kill-gear", "disarming-rake.may-kill-gear"]
  );
  assert.equal(resultFor(outcome, "disarming-rake.kill-gear").result.status, "executed");
  assert.equal(resultFor(outcome, "disarming-rake.may-kill-gear").result.status, "executed");
  // 429.1 / 429.2.a: the kill moves the gear from the Board to its owner's Trash.
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.deepEqual(kernel.events.map(event => event.action), ["kill"]);
});

test("sfd-032-221 Disarming Rake golden: declining skips the kill and leaves the gear on the Board", () => {
  const kernel = world()
    .unit("rake", { might: 2 })
    .unit("kept-gear", { types: ["gear"], owner: "B" })
    .build();
  const outcome = resolveWith(kernel, { gearRef: kernel.ref("kept-gear"), accepted: false });

  assert.deepEqual(outcome.results.map(entry => entry.id), ["disarming-rake.may-kill-gear"]);
  assert.equal(resultFor(outcome, "disarming-rake.may-kill-gear").result.status, "negated");
  assert.equal(resultFor(outcome, "disarming-rake.may-kill-gear").result.reason, "skipped");
  assert.equal(kernel.getObject("kept-gear").zone, "board");
  assert.deepEqual(kernel.events, []);
});

test("sfd-032-221 Disarming Rake golden: a gear that left the Board makes the may instruction ignored (CR 359.3.e)", () => {
  const kernel = world()
    .unit("rake", { might: 2 })
    .unit("fleeing-gear", { types: ["gear"], owner: "B" })
    .build();
  const stale = kernel.ref("fleeing-gear");
  // The gear changed zones after Finalize but before resolution.
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const outcome = resolveWith(kernel, { gearRef: stale, accepted: true });

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => entry.id), ["disarming-rake.may-kill-gear"]);
  assert.deepEqual(resultFor(outcome, "disarming-rake.may-kill-gear").result, {
    status: "ignored",
    reason: "mistargeted"
  });
  assert.equal(kernel.getObject("fleeing-gear").zone, "hand");
  assert.deepEqual(kernel.events.map(event => event.action), ["move-zone"]);
});

test("sfd-032-221 Disarming Rake golden: the merged kill primitive alone kills a gear", () => {
  const kernel = world().unit("only-gear", { types: ["gear"], owner: "B" }).build();
  const run = runInstruction(
    kill,
    { target: TARGET_ID },
    { world: kernel, targets: { [TARGET_ID]: [kernel.ref("only-gear")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
  assert.equal(kernel.getObject("only-gear").zone, "trash");
  assert.deepEqual(run.linked.killed, [{ id: "only-gear", zoneEntryId: 1 }]);
});

test.todo(
  "sfd-032-221 Disarming Rake: the card-played trigger enters the chain as a Pending item after the " +
    "unit is played (CR 383.4.a.2, 420.4.a) and Finalize locks the gear target with revalidation " +
    "(CR 355.8, 355.9) — depends on the production trigger/chain wiring (RIFT-120)"
);
