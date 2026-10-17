import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/time-warp.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-037ac90c7e1ee070f9dea523811caa91e2b1f5c8018e4cc7753149ebb5eba7d7";
const SOURCE_TEXT = "Take a turn after this one. Banish this.";

const play = program.abilities[0];
const [additionalTurn, banishThis] = play.body;

// The two instructions are independent sentences, so the banish half runs on
// its own even while the Additional Turn half stays unimplemented.
const banishOnly = [banishThis];

test("Time Warp program is structurally valid and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /734/);
  assert.match(program.judgeReason, /Additional Turn/);
  assert.match(program.judgeReason, /effect\.banish/);
  // Re-probed 2026-10-17: the op is not even registered, which the reason now
  // names together with the missing turn-queue consumer.
  assert.match(program.judgeReason, /registry\.generated/);
  assert.match(program.judgeReason, /Unregistered instruction opcode/);
  assert.match(program.judgeReason, /turnQueue|回合队列/);
  // The judgeReason must name the actual gap (contract 3.1 / README §2).
});

test("Time Warp identity and printed text match the catalog", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Time Warp structure: the described Additional Turn clause and the banish-this clause", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["take-turn-after-this", "effect.additional-turn"],
    ["banish-this", "effect.banish"]
  ]);

  // 734/735: a temporary Additional Turn owned by that player, inserted after
  // the current one. No merged opcode consumes this shape.
  assert.deepEqual(additionalTurn.args, {
    owner: { kind: "constant", value: "controller" },
    after: { kind: "constant", value: "this-turn" }
  });
  assert.equal(additionalTurn.targets, undefined);
  assert.equal(additionalTurn.picks, undefined);

  // "Banish this" uses the contract 3.6 "source" ObjectSelector; it is an
  // independent sentence, not linked to the turn clause (359.3.e.14).
  assert.deepEqual(banishThis.args, { objects: { kind: "constant", value: "source" } });
  assert.equal(banishThis.linkedTo, undefined);
  assert.equal(banishThis.targets, undefined);
});

test("Time Warp golden: 'Banish this' banishes the spell itself to its owner's Banishment", () => {
  const base = world().card("time-warp", { types: ["spell"], zone: "chain" }).build();
  // The resolve context's source is the spell instance on the Chain.
  const kernel = base.clone({ sourceSnapshot: base.getObject("time-warp") });
  const run = runInstruction(banish, { objects: banishThis.args.objects }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
  assert.equal(kernel.getObject("time-warp").zone, "banishment");
  assert.equal(kernel.objectsInZone("A", "chain").length, 0);
  assert.deepEqual(kernel.objectsInZone("A", "banishment"), [kernel.ref("time-warp")]);
  // The linked receipt keeps the original source ref (428.3.a: links are per
  // instruction and source instance, not an aggregate by card name).
  assert.deepEqual(run.linked.banished.source, base.ref("time-warp"));
  assert.deepEqual(run.linked.banished.objects, [kernel.ref("time-warp")]);
});

test("Time Warp golden: the banish half runs through the production chain body unchanged", () => {
  const base = world().card("time-warp", { types: ["spell"], zone: "chain" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("time-warp") });

  const outcome = resolveChainBody(banishOnly, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["banish-this", "executed"]
  ]);
  assert.equal(kernel.getObject("time-warp").zone, "banishment");
});

test("Time Warp boundary: effect.additional-turn is not a registered instruction (CR 734/735)", () => {
  // Re-probed 2026-10-17: the authored opcode has no entry in the merged
  // instruction registry, so even a direct resolve of the card's own body fails
  // before any turn-queue question is reached.
  assert.equal(instructionDefinitionsById.has("effect.additional-turn"), false);
  const kernel = world().card("time-warp", { types: ["spell"], zone: "chain" }).build();
  assert.throws(
    () => resolveChainBody([additionalTurn], kernel.clone({ sourceSnapshot: kernel.getObject("time-warp") })),
    /Unregistered instruction opcode: effect\.additional-turn/
  );
  // The independent banish sentence is unaffected by that gap, which is what
  // makes this a per-clause block rather than a whole-body failure.
  const banishHalf = resolveChainBody([banishThis], kernel.clone({ sourceSnapshot: kernel.getObject("time-warp") }));
  assert.equal(banishHalf.status, "executed");
});

test("Time Warp boundary: turn/ exposes phase progression but no temporary-turn queue (CR 735–738)", async () => {
  // Re-probed 2026-10-17: the merged turn module drives awaken/beginning/…/main
  // phases, and its public surface has no Additional Turn insertion or restore
  // entry. 735 requires the effect to create a temporary turn inserted after the
  // current one, and 736–738 require the repeating turn order to stay intact, so
  // neither the insertion nor the completion-restore half exists yet.
  const flow = await import("../../../../engine-core/dist/turn/flow.js");
  assert.equal(typeof flow.TurnFlow, "function");
  const surface = Object.getOwnPropertyNames(flow.TurnFlow.prototype).join(" ");
  assert.doesNotMatch(surface, /additionalTurn|queueAdditionalTurn|extraTurn/i);
  // The authored shape still describes the rules contract it cannot execute.
  assert.deepEqual(additionalTurn.args.after, { kind: "constant", value: "this-turn" });
  assert.deepEqual(additionalTurn.args.owner, { kind: "constant", value: "controller" });
});

test("Time Warp: the merged play binder preserves both independent instructions", async () => {
  const { describePlay } = await import("../../../../engine-core/dist/programs/play.js");
  const { ProgramRegistry } = await import("../../../../engine-core/dist/programs/registry.js");
  // Inspect the supported play adapter with an explicit test-only binding view;
  // the real registry entry remains judge-required for Additional Turns.
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const kernel = world().hand("time-warp", { cardId: CANONICAL, types: ["spell"], energy: 10, power: ["Mind", "Mind", "Mind", "Mind"] }).build();
  const source = kernel.getObject("time-warp");
  const draft = describePlay(registry, { type: "play", object: source.ref, player: "A" }, source);
  assert.equal(draft.kind, "spell");
  assert.deepEqual(draft.body, play.body);
  assert.equal(draft.speed, "normal");
});
