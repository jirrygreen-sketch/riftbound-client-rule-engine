import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/mystic-reversal.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-ea7dd5402b09dfde273f51aee83776f88c4e3f1fb8f52b4863aa43d307a8ebda";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Gain control of a spell. You may make new choices for it.";

const [reactionKeyword, play] = program.abilities;
const [gainControl, mayRemake] = play.body;
const [remakeChoices] = mayRemake.args.body.value;
const targetSpec = gainControl.targets[0];

test("ogn-080-298 Mystic Reversal: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-080-298 Mystic Reversal identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-080-298 Mystic Reversal judgeReason names both missing pieces", () => {
  assert.match(program.judgeReason, /take-control/);
  assert.match(program.judgeReason, /RIFT-117/);
  assert.match(program.judgeReason, /752\.1/);
  assert.match(program.judgeReason, /753/);
  assert.match(program.judgeReason, /755/);
});

test("ogn-080-298 Mystic Reversal structure: [Reaction], a chain-spell control target, and a may-wrapped remake", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "mystic-reversal.gain-control",
    "mystic-reversal.may-remake-choices"
  ]);

  // "Gain control of a spell": the Chain item is the target (355.9.a.2).
  assert.equal(gainControl.op, "effect.control");
  assert.deepEqual(gainControl.args, {
    target: { kind: "constant", value: "mystic-reversal.spell" }
  });
  assert.deepEqual(targetSpec, {
    id: "mystic-reversal.spell",
    filter: { type: "spell", zone: "chain" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(gainControl.linkedTo, undefined);

  // "You may make new choices for it" — contract 3.9: the may wraps the remake
  // instruction inside body, and the remake is linked because "it" refers to
  // the same chain item (359.3.e.14).
  assert.equal(mayRemake.op, "choice.optional");
  assert.equal(mayRemake.linkedTo, "mystic-reversal.gain-control");
  assert.equal(mayRemake.args.body.kind, "constant");
  assert.deepEqual(mayRemake.args.body.value.map(instruction => instruction.id), [
    "mystic-reversal.remake-choices"
  ]);
  assert.equal(remakeChoices.op, "choice.remake-chain-item-choices");
  assert.equal(remakeChoices.linkedTo, undefined);
  assert.deepEqual(remakeChoices.args.item.value, { linked: "mystic-reversal.gain-control" });
  // 752.1 limits the remade choice classes; 753 requires remaking all of them.
  assert.deepEqual(remakeChoices.args.choices, {
    kind: "constant",
    value: ["location", "mode", "destination", "target"]
  });
  assert.deepEqual(remakeChoices.args.remakeAll, { kind: "constant", value: true });
});

test("ogn-080-298 Mystic Reversal: the declared dependencies really are unregistered", () => {
  assert.equal(instructionDefinitionsById.has("effect.control"), false);
  assert.equal(instructionDefinitionsById.has("choice.remake-chain-item-choices"), false);
  // The [Reaction] speed keyword is merged even though its consumer is not.
  assert.equal(keywordDefinitionsById.has("Reaction"), true);
});

test("ogn-080-298 Mystic Reversal golden: declining the may skips the remake and leaves the chain item alone", () => {
  // Guards against the wrong fix: the may must not degrade into an
  // unconditional no-op. The reference kernel has no control/remake primitive,
  // so the wrapper is run without its forward link to the unmerged control
  // instruction and only the decision handling is exercised.
  const kernel = world().object("enemy-spell", { zone: "chain", owner: "B", controller: "B", types: ["spell"] }).build();
  kernel.setAnswers({ "mystic-reversal.may-remake-choices/optional": false });
  const { linkedTo, ...mayRemakeWithoutLink } = mayRemake;

  const outcome = runAbilityBody([mayRemakeWithoutLink], kernel);

  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status, result.result.reason]), [
    ["mystic-reversal.may-remake-choices", "negated", "skipped"]
  ]);
  assert.equal(kernel.events.length, 0);
  assert.equal(kernel.getObject("enemy-spell").zone, "chain");
  assert.equal(kernel.getObject("enemy-spell").controller, "B");
});

test("ogn-080-298 Mystic Reversal golden: the merged counter primitive shows the Chain-item recheck the control clause lacks", () => {
  // The control clause needs the same "still current on the Chain" legality the
  // merged counter primitive already enforces (359.3.e), which is why the
  // program keeps the filter on the TargetSpec rather than a query.
  const kernel = world().object("enemy-spell", { zone: "chain", owner: "B", controller: "B", types: ["spell"] }).build();
  const run = runInstruction(counter, { target: targetSpec.id }, {
    world: kernel,
    targets: { [targetSpec.id]: [kernel.ref("enemy-spell")] }
  });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["counter"]);
});

test.todo(
  "Mystic Reversal: change the controlling player of the targeted Chain item (contract 3.6 GameAction " +
    "take-control; the survey's effect.control) - a card-level control change on the Chain, not a Board " +
    "control change - needs the effect.control instruction primitive (RIFT-117)"
);

test.todo(
  "Mystic Reversal: Making New Choices (CR 750-755) - re-open the finalized item's choice plan for " +
    "locations/modes/destinations/targets only (752.1), remake all of them (753/753.3), negate when no legal " +
    "choice exists (753.2), re-trigger targeting effects (754) and ignore resulting to-play costs (755) - " +
    "needs chain/target-plan re-selection support (RIFT-90/RIFT-120)"
);

test.todo(
  "Mystic Reversal: [Reaction] admission (813.1.b/813.1.c) belongs to the chain's canAct check plus the " +
    "continuous.timing consumer (contract 3.5 / RIFT-91)"
);
