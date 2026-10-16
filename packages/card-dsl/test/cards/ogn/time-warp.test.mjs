import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/time-warp.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
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
  // The judgeReason must name the actual gap (contract 3.1 / README §2).
  assert.match(program.judgeReason, /734/);
  assert.match(program.judgeReason, /Additional Turn/);
  assert.match(program.judgeReason, /effect\.banish/);
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

test.todo(
  "Time Warp: 'Take a turn after this one' needs an Additional Turn inserted into the " +
    "turn queue (734/735-738): a turn-queue GameAction or turn/ API plus the appropriate " +
    "timing boundary. Not approximated by skipping a phase or reusing turn-start."
);
