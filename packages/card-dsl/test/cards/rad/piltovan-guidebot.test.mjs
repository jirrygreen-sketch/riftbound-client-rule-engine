import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/piltovan-guidebot.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CANONICAL = "card.hash-615e60700f249a984f869bffcbf2ce12e1b4090a85115e2a97fc5432e1df1fc0";
const SOURCE_TEXT =
  "When you play a card, you may have my base Might become equal to that card's Energy cost this turn.";

const [triggered] = program.abilities;
const [optional] = triggered.body;
const [setBaseMight] = optional.args.body.value;

test("rad-057-167 Piltovan Guidebot: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-057-167 Piltovan Guidebot: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /base Might/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /Energy cost/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-057-167 Piltovan Guidebot: 'when you play a card' subscribes card-played for the controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  // "打出任意一张牌"都触发：不加 self 过滤，只限定玩家（能力控制者）。
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { player: "controller" }
  });
  // 触发本身是强制的；"you may" 由 choice.optional 承担（契约 3.9）。
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
});

test("rad-057-167 Piltovan Guidebot: 'you may' wraps the base-Might set in a choice.optional body (contract 3.9)", () => {
  assert.equal(optional.id, "piltovan-guidebot.may-set-base-might");
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.args.body.kind, "constant");
  assert.deepEqual(
    optional.args.body.value.map((instruction) => [instruction.id, instruction.op]),
    [["piltovan-guidebot.set-base-might", "continuous.base-might"]]
  );
  // 契约 3.9：不要写成 choice + 后续指令 linkedTo。
  assert.equal(optional.linkedTo, undefined);
  assert.equal(setBaseMight.linkedTo, undefined);
});

test("rad-057-167 Piltovan Guidebot: the base-Might set is authored as a trait-layer set with end-of-turn duration", () => {
  assert.deepEqual(setBaseMight.args.mode, { kind: "constant", value: "set" });
  // CR 143.2.a："Its base Might becomes 5 this turn" 是 Trait-Altering 层的设值。
  assert.deepEqual(setBaseMight.args.layer, { kind: "constant", value: "trait" });
  assert.deepEqual(setBaseMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(setBaseMight.args.source, { kind: "constant", value: "played-card-energy-cost" });
  assert.deepEqual(setBaseMight.targets, [
    {
      id: "piltovan-guidebot.self",
      filter: { type: "unit", object: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-057-167 Piltovan Guidebot: the base-Might op is not registered", () => {
  assert.equal(instructionDefinitionsById.get("continuous.base-might"), undefined);
});

test.todo(
  "rad-057-167 Piltovan Guidebot: set the Base Might in the trait-altering layer and read 'that card's Energy cost' from " +
    "the triggering card-played event (CR 143.2.a; the ResolveContext has no trigger-event accessor and cost.printed is " +
    "unmerged — RIFT-91 follow-up, no assigned task for the trait-layer set primitive)"
);

test.todo(
  "rad-057-167 Piltovan Guidebot: expire the Base Might set at the end-of-turn cleanup (CR 475 / 318) — depends on " +
    "RIFT-91 continuous.duration"
);

test.todo(
  "rad-057-167 Piltovan Guidebot: emit the card-played event with the played card identity so the trigger can read it " +
    "(CR 420.4.a) — depends on RIFT-120 chain/event integration"
);
