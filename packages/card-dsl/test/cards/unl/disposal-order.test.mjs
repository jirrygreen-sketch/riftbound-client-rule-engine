import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/disposal-order.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { describePlay } from "../../../../engine-core/dist/programs/play.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";

const CANONICAL_ID =
  "card.hash-ae826439bb4605b7d72d3b0b431548f77c4cde681a949dd0e613036488b554c0";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose one —\n" +
  "Choose up to 3 cards from opponents' trashes. Their owners recycle them.Draw 1.";

const [reaction, play] = program.abilities;
const [mode] = play.body;
const [recycleMode, drawMode] = mode.args.modes.value;
const [recycleInstruction] = recycleMode.body;
const [drawInstruction] = drawMode.body;

test("unl-103-219 Disposal Order: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-103-219 Disposal Order: identity, status, judgeReason and verbatim sourceText (catalog tail kept)", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The catalog's missing space/newline between "them." and "Draw 1" is kept
  // verbatim; the data issue is reported in the task reply, not edited.
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.sourceText.includes("them.Draw 1"), true);
  assert.match(program.judgeReason, /108\.2\.a/);
  assert.match(program.judgeReason, /355\.13/);
  assert.match(program.judgeReason, /effect\.recycle/);
  // Each gap must carry its verified current evidence.
  assert.match(program.judgeReason, /fail-closed/);
  assert.match(program.judgeReason, /expected exactly 3 chosen object\(s\), got 1/);
  assert.match(program.judgeReason, /Mode choices require a Finalize\/Resolve choice-plan adapter/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.match(program.judgeReason, /validateSurface/);
  assert.match(program.judgeReason, /single-owner/);
});

test("unl-103-219 Disposal Order: [Reaction] plus a two-mode choice (recycle | draw)", () => {
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.equal(mode.op, "choice.mode");
  // 355.3 / contract 3.9: exactly one exclusive mode, written as a choice.mode
  // node rather than a choice plus linkedTo.
  assert.deepEqual(mode.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(mode.args.different, { kind: "constant", value: true });
  assert.equal(mode.linkedTo, undefined);
  assert.deepEqual(
    mode.args.modes.value.map((entry) => entry.id),
    ["disposal-order.recycle-mode", "disposal-order.draw-mode"]
  );
  assert.equal(recycleMode.body.length, 1);
  assert.equal(drawMode.body.length, 1);

  // Mode one: "Choose up to 3 cards from opponents' trashes" is the 417.6
  // non-targeting recycle form; 108.2.a makes "trashes" a per-player zone set
  // that the merged from shape cannot express (see judgeReason).
  assert.equal(recycleInstruction.op, "effect.recycle");
  assert.deepEqual(recycleInstruction.args.from, {
    kind: "constant",
    value: {
      zone: "trash",
      owner: "opponents",
      amount: { kind: "constant", value: 3 }
    }
  });
  assert.equal(recycleInstruction.targets, undefined);
  assert.equal(recycleInstruction.picks, undefined);

  // Mode two: an independent Draw 1 (414.1).
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
});

const executableBody = [
  {
    ...mode,
    args: {
      ...mode.args,
      modes: {
        ...mode.args.modes,
        value: [recycleMode, drawMode].map((entry) => ({
          ...entry,
          body: entry.body.map(({ targets, ...instruction }) => instruction)
        }))
      }
    }
  }
];

test("unl-103-219 Disposal Order golden: choosing the draw mode draws exactly one card", () => {
  const kernel = world().player("A").deck(["top-card", "next-card"]).build();
  kernel.setAnswers({ "disposal-order.choose-mode/mode%3A0": "disposal-order.draw-mode" });

  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["disposal-order.choose-mode.value"], [
    "disposal-order.draw-mode"
  ]);
  const result = outcome.results.find((entry) => entry.id === "disposal-order.draw-1");
  assert.equal(result.result.status, "executed");
  assert.equal(result.result.linkedValues.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("unl-103-219 Disposal Order golden: the merged recycle-from-trash form recycles the chooser's own cards", () => {
  // The shape that IS merged (single owner) is exercised so the TODO below is
  // the only thing standing between this card and execution.
  const kernel = world().player("A").card("t1", { zone: "trash" }).card("t2", { zone: "trash" }).build();
  const run = runInstruction(
    recycle,
    {
      from: {
        zone: "trash",
        owner: "controller",
        amount: { kind: "constant", value: 1 }
      }
    },
    {
      world: kernel,
      // effect.recycle asks the zone's owner to choose; the reference kernel
      // receives the answer for the stable request id it builds.
      answers: { "effect.recycle:trash:controller:1": [kernel.ref("t1")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 1);
  assert.deepEqual(kernel.objectsInZone("A", "trash").map((ref) => ref.id), ["t2"]);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), ["t1"]);
});

test("unl-103-219 Disposal Order golden: the drawn-mode choice plus Draw 1 really execute through the proxy chain body", () => {
  // RIFT-329 re-review: the choice.mode structure and the Draw 1 mode execute
  // through the real interpreter with the production adapter's registry, so the
  // reason's remaining mode-adapter gap is scoped to the chain's own Finalize
  // surface rather than the interpreter.
  const kernel = world().player("A").deck(["top-card", "next-card"]).build();
  kernel.setAnswers({ "disposal-order.choose-mode/mode%3A0": "disposal-order.draw-mode" });

  const outcome = resolveChainBody(executableBody, kernel);

  assert.deepEqual(outcome.linkedValues["disposal-order.choose-mode.value"], ["disposal-order.draw-mode"]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top-card"]);
  // The two modes' own primitives are both registered instructions.
  assert.equal(instructionDefinitionsById.has("effect.draw"), true);
  assert.equal(instructionDefinitionsById.has("effect.recycle"), true);
});

test.todo(
  "unl-103-219 Disposal Order: 'up to 3 cards from opponents' trashes' needs a multi-owner zone selection with a " +
    "player-chosen 0..3 count (CR 108.2.a / 355.13 / 417.6) — effect.recycle from takes one owner and locks the count"
);

test("unl-103-219 Disposal Order: the declared multi-owner owner is rejected fail-closed, and a smaller up-to answer is refused", () => {
  // (1) 108.2.a: "opponents' trashes" is a per-player zone set. The merged
  // from shape accepts only controller/source-owner, so the authored
  // descriptive owner must be rejected rather than silently read as the
  // controller's own trash. (Real primitives: effect.recycle argsSchema.)
  assert.throws(
    () => recycle.argsSchema.parse(recycleInstruction.args.from.value),
    (error) => /effect\.recycle requires at least one of target, objects, or from/.test(error.message)
  );
  // (2) 355.13: "up to 3" must accept a smaller answer. The merged from shape
  // locks the count to exactly min(3, available), so answering 1 throws.
  const kernel = world()
    .player("A")
    .player("B")
    .deck(["a1", "a2", "a3", "a4"], { owner: "A" })
    .build();
  for (const ref of kernel.objectsInZone("A", "deck").slice()) {
    assert.equal(kernel.perform({ type: "move-zone", object: ref, to: "trash" }).status, "done");
  }
  assert.equal(kernel.objectsInZone("A", "trash").length, 4);
  const source = kernel.objectsInZone("A", "trash")[0];
  const context = bindResolveContext(kernel, { source, controller: "A" });
  const locked = bindResolveContext(context, {
    choose: (request) => [...request.options].slice(0, 1)
  });
  assert.throws(
    () => resolveChainBody(
      [{
        id: "up-to-three",
        op: "effect.recycle",
        args: {
          from: {
            kind: "constant",
            value: { zone: "trash", owner: "controller", amount: { kind: "constant", value: 3 } }
          }
        }
      }],
      locked
    ),
    (error) => /effect\.recycle expected exactly 3 chosen object\(s\), got 1/.test(error.message)
  );
});

test("unl-103-219 Disposal Order: the production play surface blocks the 'Choose one —' body", () => {
  // 355.3: the mode question belongs to the chain's Finalize/Resolve
  // lifecycle. Both the program-binding surface and the chain's own
  // finalization guard reject choice.mode inside a card body, so the card
  // cannot be marked executable on this declaration.
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const spell = {
    ref: { id: "disposal-order", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Disposal Order",
    types: ["spell"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "hand",
    location: null,
    might: null,
    energy: 2,
    power: [],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  assert.throws(
    () => describePlay(registry, { type: "play", object: spell.ref, player: "A" }, spell),
    (error) => /Mode choices require a Finalize\/Resolve choice-plan adapter/.test(error.message)
  );
});
