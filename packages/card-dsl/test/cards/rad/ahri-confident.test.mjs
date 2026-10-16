import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ahri-confident.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-b5c30bb9570eb87f81c02526593c66f04d242c43ca13f9e3f0e38ed148fe62c1";
const SOURCE_TEXT =
  "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
  "When you reduce the Might of an enemy unit here by 1 or more, give me +1 :rb_might: this turn.";

const [keyword, triggered] = program.abilities;
const [instruction] = triggered.body;

test("rad-038-167 Ahri, Confident: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-038-167 Ahri, Confident: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README 第 2 节：judgeReason 要写清缺哪个 op、哪条规则、依赖哪个任务。
  assert.match(program.judgeReason, /Disarm/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-038-167 Ahri, Confident: unvalued Disarm keyword (831.1.c.3 default 1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "disarm" });
  assert.equal(keyword.value, undefined);
});

test("rad-038-167 Ahri, Confident: might-changed trigger filters a here-and-now reduction", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "might-changed");
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.trigger.filter, {
    event: "might-changed",
    filter: {
      type: "unit",
      controller: "opponent",
      sameLocationAs: "self",
      mightChanged: "decreased",
      amount: { gte: 1 }
    }
  });
});

test("rad-038-167 Ahri, Confident: +1 Might this turn is authored as an arithmetic trait-layer effect on self", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(instruction.id, "ahri-confident.give-me-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(instruction.args.layer, { kind: "constant", value: "arithmetic" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(instruction.targets, [
    {
      id: "ahri-confident.self",
      filter: { type: "unit", object: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(instruction.linkedTo, undefined);
});

test.todo(
  "rad-038-167 Ahri, Confident: execute Disarm 1 (attack trigger + telegraphic -1 Might this turn) once the " +
    "Disarm KeywordDef and the continuous.might / continuous.duration primitives land (no assigned task; RIFT-91 layers)"
);

test.todo(
  "rad-038-167 Ahri, Confident: emit and filter the might-changed payload (previousMight/currentMight, CR 709, " +
    "sameLocationAs \"self\") so the +1 Might reward fires — depends on RIFT-91 layers evaluation feeding the event pipeline"
);

test.todo(
  "rad-038-167 Ahri, Confident: apply the +1 Might arithmetic effect through the layer engine and expire it at the " +
    "end-of-turn cleanup (CR 143.2.a / 475) — depends on RIFT-91"
);

test("rad-038-167 Ahri, Confident: the depended-on opcodes and keywords are not yet registered", () => {
  // RIFT-9 调研与 README 第 2 节：能写出 IR 不等于可执行。记录真实缺口，避免后来者误判。
  assert.equal(keywordDefinitionsById.get("disarm"), undefined);
  assert.equal(instructionDefinitionsById.get("continuous.might"), undefined);
});
