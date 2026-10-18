import assert from "node:assert/strict";
import test from "node:test";

import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { AwaitChoice, runInstruction, world } from "../../dist/effects/testing/index.js";
import targetPlayer from "../../dist/effects/instructions/target.player.js";
import eachPlayer from "../../dist/effects/instructions/choice.each-player.js";
import eachOtherPlayer from "../../dist/effects/instructions/choice.each-other-player.js";
import playForEachPlayer from "../../dist/effects/instructions/effect.play-for-each-player.js";
import mindsplitter from "../../../card-dsl/dist/cards/ogn/mindsplitter.js";
import { instructionDefinitionsById } from "../../dist/effects/instructions/registry.generated.js";

const literal = value => ({ kind: "literal", value });

test("target.player chooses a real opponent PlayerId and records responsibility", () => {
  const kernel = world().player("C").unit("ally", { owner: "A" }).unit("enemy", { owner: "B" }).build();
  const args = {
    chooser: literal("controller"),
    filter: literal({ player: "opponent" }),
    linkKey: literal("chosenOpponent")
  };

  const asked = runInstruction(targetPlayer, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.chooser, "A");
  assert.deepEqual(asked.asked.request.options, ["B", "C"]);
  assert.deepEqual(asked.linked, {});

  const answered = runInstruction(targetPlayer, args, {
    world: kernel,
    answers: { player: "C" }
  });
  assert.equal(answered.result?.status, "executed");
  assert.equal(answered.linked.chosenOpponent, "C");
  assert.equal(answered.linked["chosenOpponent.responsiblePlayerId"], "A");
});

test("target.player expands dynamic opponent options from the trusted roster", () => {
  const kernel = world().player("C").build();
  const args = {
    options: literal("dynamic:opponent-players"),
    chooser: literal("controller"),
    linkKey: literal("opponent")
  };
  const asked = runInstruction(targetPlayer, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.deepEqual(asked.asked.request.options, ["B", "C"]);
});

test("each-other-player walks the trusted roster in turn order with the actual chooser", () => {
  const kernel = world().player("C").unit("a", { owner: "A" }).unit("b", { owner: "B" }).unit("c", { owner: "C" }).build();
  const args = { modes: literal([{ id: "cards", body: [] }, { id: "runes", body: [] }]) };
  const asked = runInstruction(eachOtherPlayer, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.chooser, "B");
  assert.equal(asked.asked.request.id, "choices:B:mode");

  const answered = runInstruction(eachOtherPlayer, args, {
    world: kernel,
    answers: { "choices:B:mode": "cards", "choices:C:mode": "runes" }
  });
  assert.equal(answered.result?.status, "executed");
  assert.deepEqual(Object.keys(answered.linked.choices), ["B", "C"]);
  assert.equal(answered.linked.choices.B.responsiblePlayerId, "B");
  assert.equal(answered.linked.choices.C.choices[0], "runes");
});

test("each-player preserves an explicit empty branch when a seat has no legal object", () => {
  const kernel = world().player("C").build();
  const args = {
    choose: literal({ filter: { type: "gear", zone: "board", controller: "controller" }, count: 1 }),
    resultKey: literal("gearChoices")
  };
  const run = runInstruction(eachPlayer, args, { world: kernel });
  assert.equal(run.result?.status, "executed");
  assert.deepEqual(Object.keys(run.linked.gearChoices), ["A", "B", "C"]);
  assert.deepEqual(run.linked.gearChoices.A.objects, []);
  assert.equal(run.linked.gearChoices.A.responsiblePlayerId, "A");
});

test("each-player rejects an illegal answer without committing a selection", () => {
  const kernel = world().player("B").build();
  const args = { modes: literal([{ id: "cards", body: [] }]) };
  const run = runInstruction(eachPlayer, args, { world: kernel, answers: { "choices:A:mode": "ghost" } });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(run.linked, {});
});

test("play-for-each-player uses each seat's PlayerId and responsibility", () => {
  const kernel = world().player("B").hand("spell-a", { owner: "A" }).hand("spell-b", { owner: "B" }).build();
  const refs = { A: kernel.ref("spell-a"), B: kernel.ref("spell-b") };
  const args = {
    objects: literal({
      A: { objects: [refs.A] },
      B: { objects: [refs.B] }
    }),
    order: literal("starting-with-current-player"),
    linkKey: literal("plays")
  };
  const run = runInstruction(playForEachPlayer, args, { world: kernel });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.plays.count, 2);
  assert.deepEqual(run.linked.plays.responsiblePlayerIds, { A: "A", B: "B" });
  assert.equal(run.world.getObject("spell-a").zone, "board");
  assert.equal(run.world.getObject("spell-b").zone, "board");
});

test("play-for-each-player rolls back earlier actions when a later play is rejected", () => {
  const kernel = world().player("B").hand("spell-a", { owner: "A" }).hand("spell-b", { owner: "B" }).build();
  kernel.addReplacement(action => action.type === "play" && action.object.id === "spell-b" ? "impossible" : null);
  const prototype = Object.getPrototypeOf(kernel);
  const prior = prototype.transaction;
  prototype.transaction = function transaction(run) {
    const before = this.snapshot();
    const result = run();
    if (result.status === "negated") this.restore(before);
    return result;
  };
  try {
    const args = {
      objects: literal({
        A: { objects: [kernel.ref("spell-a")] },
        B: { objects: [kernel.ref("spell-b")] }
      })
    };
    const run = runInstruction(playForEachPlayer, args, { world: kernel });
    assert.equal(run.result?.status, "negated");
    assert.equal(run.world.getObject("spell-a").zone, "hand");
    assert.equal(run.world.getObject("spell-b").zone, "hand");
  } finally {
    if (prior === undefined) delete prototype.transaction;
    else prototype.transaction = prior;
  }
});

test("play-for-each-player ignores a stale object incarnation without assigning it to a seat", () => {
  const kernel = world().hand("spell-a", { owner: "A" }).build();
  const stale = kernel.ref("spell-a");
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "trash" }).status, "done");
  const run = runInstruction(playForEachPlayer, { objects: literal([stale]) }, { world: kernel });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.linked, {});
});

test("the original Mindsplitter target.player IR reaches the default production registry", () => {
  assert.equal(instructionDefinitionsById.has("target.player"), true);
  const instruction = mindsplitter.abilities[0].body[0];
  const kernel = world().unit("source", { owner: "A" }).hand("opponent-card", { owner: "B" }).build();
  kernel.setAnswers({ "mindsplitter.choose-opponent/player": "B" });
  const outcome = resolveChainBody([instruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["mindsplitter.choose-opponent.chosenOpponent"], "B");
});
