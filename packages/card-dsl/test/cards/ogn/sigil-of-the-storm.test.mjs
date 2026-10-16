import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/sigil-of-the-storm.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL = "card.hash-99269cca1e28890ac67140558b99391b7697d84d62ce158a0946bed6920daedd";
const [ability] = program.abilities;
const [instruction] = ability.body;
const RECYCLE_ARGS = {
  from: { zone: "rune-zone", amount: { kind: "constant", value: 1 } }
};

test("ogn-287-298 Sigil of the Storm: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /RIFT-31/);
  assert.match(program.judgeReason, /RIFT-33/);
  assert.equal(program.sourceText, "When you conquer here, recycle one of your runes.");
});

test("ogn-287-298: conquer trigger whose body recycles one rune (417.6 non-targeting form)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, {
    event: "conquer",
    here: true,
    player: "controller"
  });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "sigil.recycle-one-rune");
  assert.equal(instruction.op, "effect.recycle");
  assert.equal(instruction.linkedTo, undefined);
  // "one of your runes" is not a target (417.6): the instruction carries no
  // TargetSpec and uses the from-zone form, whose default owner is the ability
  // controller.
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.deepEqual(instruction.args, {
    from: {
      kind: "constant",
      value: { zone: "rune-zone", amount: { kind: "constant", value: 1 } }
    }
  });
  assert.deepEqual(RECYCLE_ARGS.from.amount, instruction.args.from.value.amount);
});

test("ogn-287-298: the body recycles exactly one chosen rune to the Rune Deck (417.1.b)", () => {
  const kernel = world()
    .card("rune-a", { zone: "rune-zone", types: ["rune"] })
    .card("rune-b", { zone: "rune-zone", types: ["rune"] })
    .build();

  // 417.6: the recycling player chooses from the zone as the effect resolves,
  // so the primitive suspends and rolls back while awaiting the answer.
  const asked = runInstruction(recycle, RECYCLE_ARGS, { world: kernel });
  assert.equal(asked.asked.request.type, "select-objects");
  assert.equal(asked.asked.request.min, 1);
  assert.equal(asked.asked.request.max, 1);
  assert.equal(asked.asked.request.chooser, "A");
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.equal(kernel.player("A").runePool.length, 2);

  const ran = runInstruction(recycle, RECYCLE_ARGS, {
    world: kernel,
    answers: { [asked.asked.request.id]: [kernel.ref("rune-b")] }
  });
  assert.equal(ran.result.status, "executed");
  assert.deepEqual(ran.events.map(event => event.action), ["recycle"]);
  assert.equal(ran.linked.recycledCount, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.getObject("rune-b").zone, "rune-deck");
  assert.equal(kernel.getObject("rune-a").zone, "rune-zone");
});

test("ogn-287-298: 417.4 recycles as many as possible when fewer runes are on the board", () => {
  const kernel = world().card("only-rune", { zone: "rune-zone", types: ["rune"] }).build();
  const asked = runInstruction(recycle, RECYCLE_ARGS, { world: kernel });
  assert.equal(asked.asked.request.min, 1);
  assert.equal(asked.asked.request.max, 1);
  assert.equal(asked.asked.request.options.length, 1);

  const ran = runInstruction(recycle, RECYCLE_ARGS, {
    world: kernel,
    answers: { [asked.asked.request.id]: [kernel.ref("only-rune")] }
  });
  assert.equal(ran.result.status, "executed");
  assert.equal(ran.linked.recycledCount, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);

  // Empty rune zone: a successful no-op, not a failure (417.4 / 431.3 spirit).
  const empty = world().deck("existing-card").build();
  const noop = runInstruction(recycle, RECYCLE_ARGS, { world: empty });
  assert.equal(noop.asked, null);
  assert.equal(noop.result.status, "executed");
  assert.equal(noop.linked.recycledCount, 0);
});

test("ogn-287-298: the trigger filter still carries the unreplaced here placeholder", () => {
  assert.throws(() => assertTriggerSpec(ability.trigger), /EventPattern 不允许此字段/);
});

test.todo(
  "ogn-287-298: conquer 由 scoring 发出并进链（含“scoring 不因得分被替代而消失”，470.1）" +
    "（依赖 RIFT-31 scenarios-scoring / RIFT-33 scenarios-triggers）"
);
test.todo(
  "ogn-287-298: 417.5.a“同一指令回收多张符文时由拥有者决定牌库底顺序”在回收多张时由内核呈现" +
    "（本卡只有 1 张，依赖内核顺序呈现任务）"
);
