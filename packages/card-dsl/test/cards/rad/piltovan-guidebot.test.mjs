import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/piltovan-guidebot.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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

test("rad-057-167 Piltovan Guidebot: identity, ruleset, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Base Might/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /Energy cost/);
  assert.equal(program.judgeReason.includes("trait 层"), true);
  assert.match(program.judgeReason, /RIFT-120/);
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

test.todo(
  "rad-057-167 Piltovan Guidebot: set the Base Might in the trait-altering layer (CR 143.2.a/475-478) — the merged " +
    "continuous.might only offers the arithmetic layer (mode set -> set-might inside applyArithmetic), so a trait-layer " +
    "set primitive has no assigned task number"
);

test.todo(
  "rad-057-167 Piltovan Guidebot: read 'that card's Energy cost' from the triggering card-played event — the " +
    "ResolveContext has no trigger-event object selector and no expression reads another object's printed cost"
);

test.todo(
  "rad-057-167 Piltovan Guidebot: register the triggered ability as a TriggerRegistration so it fires from the real " +
    "card-played flow (CR 420.4.a) — RIFT-120"
);
