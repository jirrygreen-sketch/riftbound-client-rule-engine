import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/cataclysmic-duel.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-52ee12e5ff701518b1a9805038c94f6a69d57289e478e7dc7d6e55ecdc1858e9";
const SOURCE_TEXT = "Each player chooses a unit they control. Kill the rest.";

const [play] = program.abilities;
const [eachPlayerChooses, killTheRest] = play.body;
const [keptUnitsPick] = eachPlayerChooses.picks;
const [restUnitsPick] = killTheRest.picks;

test("ven-090-166 Cataclysmic Duel: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-090-166 Cataclysmic Duel: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-090-166 Cataclysmic Duel: judgeReason names the multi-player choice and the complement gaps", () => {
  assert.match(program.judgeReason, /choice\.each-player/);
  assert.match(program.judgeReason, /355\.10\.e/);
  assert.match(program.judgeReason, /effect\.kill/);
  // The current, measured form of both gaps.
  assert.match(program.judgeReason, /42 个 op/);
  assert.match(program.judgeReason, /chain\/picks\/plan\.ts/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-090-166 Cataclysmic Duel: neither required op is registered, and describePlay carries the unregistered node", () => {
  // The multi-player choice has no registry entry, and no primitive expresses
  // "the complement of every player's choice".
  assert.equal(instructionDefinitionsById.has("choice.each-player"), false);
  assert.equal(instructionDefinitionsById.has("choice.each-other-player"), false);

  // The program binds as far as the play surface goes: the unregistered node is
  // carried into the chain body verbatim, so the interpreter would have no
  // branch for it. That is exactly why this card stays judge-required.
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world()
    .player("A", { energy: 20, power: ["Body", "Body", "Body"] })
    .unit("duel", { types: ["spell"], zone: "hand", owner: "A", controller: "A", cardId: CARD_ID })
    .build();
  assert.throws(
    () => binding.describePlay({ type: "play", object: kernel.ref("duel"), player: "A" }, kernel.getObject("duel")),
    error => error.name === "ProgramBindingError" && /judge-required/.test(error.code)
  );
});

test("ven-090-166 Cataclysmic Duel: printed 8 Energy + 3 Body Power cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 8 },
    power: { kind: "constant", value: 3 }
  });
});

test("ven-090-166 Cataclysmic Duel structure: each-player choice then a linked complement kill", () => {
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["cataclysmic-duel.each-player-chooses", "choice.each-player"],
    ["cataclysmic-duel.kill-the-rest", "effect.kill"]
  ]);

  // 355.10.e: "Each player chooses a unit they control" is explicitly NOT
  // targeted; the chooser set and per-player choice have no merged node
  // (judgeReason), so the structure is recorded for review.
  assert.equal(eachPlayerChooses.linkedTo, undefined);
  assert.deepEqual(eachPlayerChooses.args.choosers, { kind: "literal", value: "each-player" });
  assert.deepEqual(eachPlayerChooses.args.setKey, {
    kind: "literal",
    value: "cataclysmic-duel-kept"
  });
  assert.deepEqual(eachPlayerChooses.args.choose.value, {
    filter: { type: "unit", controller: "controller" },
    count: 1
  });
  assert.deepEqual(keptUnitsPick, {
    id: "cataclysmic-duel-kept-units",
    options: ["dynamic:units-chosen-by-each-player"],
    min: 1,
    max: 1,
    selection: "one",
    filter: { type: "unit", controller: "controller" }
  });

  // "Kill the rest." is the complement of what the players kept: the merged
  // effect.kill consumes picks (355.10.e keeps them non-target), but nothing
  // produces that complement set (judgeReason).
  assert.equal(killTheRest.linkedTo, "cataclysmic-duel.each-player-chooses");
  assert.deepEqual(killTheRest.args.picks, {
    kind: "literal",
    value: "cataclysmic-duel-rest-units"
  });
  assert.equal(killTheRest.targets, undefined);
  assert.deepEqual(restUnitsPick, {
    id: "cataclysmic-duel-rest-units",
    options: ["dynamic:units-not-chosen-by-any-player"],
    min: 0,
    max: null,
    selection: "any",
    filter: { type: "unit" }
  });
});

test("ven-090-166 Cataclysmic Duel: the merged kill half really kills the units it is given", () => {
  // The complement set has no producer (judgeReason), but the kill instruction
  // itself is the merged effect.kill primitive: feeding it the units that no
  // player kept proves the action, its events and its kill receipt.
  const kernel = world()
    .unit("kept-by-a", { owner: "A", controller: "A" })
    .unit("kept-by-b", { owner: "B", controller: "B" })
    .unit("rest-one", { owner: "A", controller: "A" })
    .unit("rest-two", { owner: "B", controller: "B" })
    .build();
  const rest = [kernel.ref("rest-one"), kernel.ref("rest-two")];

  const run = runInstruction(
    kill,
    { picks: restUnitsPick.id },
    { world: kernel, picks: { [restUnitsPick.id]: rest } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("rest-one").zone, "trash");
  assert.equal(kernel.getObject("rest-two").zone, "trash");
  // The units each player chose are untouched.
  assert.equal(kernel.getObject("kept-by-a").zone, "board");
  assert.equal(kernel.getObject("kept-by-b").zone, "board");
  assert.equal(run.events.filter(event => event.action === "kill").length, 2);
  assert.deepEqual(run.result.linkedValues.killed, rest);
});

test("ven-090-166 Cataclysmic Duel: an empty rest set kills nothing (055)", () => {
  const kernel = world()
    .unit("kept-by-a", { owner: "A", controller: "A" })
    .unit("kept-by-b", { owner: "B", controller: "B" })
    .build();
  const run = runInstruction(
    kill,
    { picks: restUnitsPick.id },
    { world: kernel, picks: { [restUnitsPick.id]: [] } }
  );

  // With no object to resolve the instruction is ignored (359.3.e) and no kill
  // happens; the chosen units survive.
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("kept-by-a").zone, "board");
  assert.equal(kernel.getObject("kept-by-b").zone, "board");
  assert.deepEqual(run.events, []);
});

test.todo(
  "ven-090-166 Cataclysmic Duel: iterate every player (including the caster) choosing one unit they " +
    "control on resolution (CR 355.10.e) — needs the multi-player ordered choice primitive the Divine " +
    "Judgment / King's Edict records also ask for (target.player / multi-player choice coordination); " +
    "the chooser set cannot name runtime player ids in static IR"
);

test.todo(
  "ven-090-166 Cataclysmic Duel: kill exactly the units that no player kept (the complement of the chosen " +
    "set, CR 429.1) — needs a complement selection and a per-spell accumulating set; effect.kill only " +
    "accepts target / picks / self and no primitive exposes \"the rest\""
);
