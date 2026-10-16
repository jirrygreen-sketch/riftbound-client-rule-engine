import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/riptide-mage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-b1ac774654b3c23d9236325b0e377a5c94866af93ca718bf2a30313a4cd027b4";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
  "When you play me, give an enemy unit -3 :rb_might: this turn.";

const [keyword, triggered] = program.abilities;
const [instruction] = triggered.body;

test("rad-058-167 Riptide Mage: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-058-167 Riptide Mage: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-058-167 Riptide Mage: unvalued Accelerate keyword (805.1.b fixed [1][C] cost)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "accelerate" });
  assert.equal(keyword.value, undefined);
  // RIFT-86 已合入 Accelerate KeywordDef（valued: false, stacking: single）。
  const definition = keywordDefinitionsById.get("Accelerate");
  assert.equal(definition?.keyword, "Accelerate");
  assert.equal(definition?.valued, false);
  assert.equal(definition?.stacking, "single");
});

test("rad-058-167 Riptide Mage: card-played self trigger gives one enemy unit -3 Might this turn", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);

  assert.equal(instruction.id, "riptide-mage.give-minus-three-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(instruction.args.layer, { kind: "constant", value: "arithmetic" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -3 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(instruction.targets, [
    {
      id: "riptide-mage.enemy-unit",
      // "an enemy unit" 不限位置：任一对手控制的 Board 单位。
      filter: { type: "unit", controller: "opponent", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-058-167 Riptide Mage: the temporary Might op is not registered", () => {
  assert.equal(instructionDefinitionsById.get("continuous.might"), undefined);
});

test.todo(
  "rad-058-167 Riptide Mage: resolve 'give an enemy unit -3 Might this turn' through the arithmetic layer " +
    "(CR 143.2.a / 475) and expire it at the end-of-turn cleanup — continuous.might has no merged consumer (RIFT-91 follow-up)"
);

test.todo(
  "rad-058-167 Riptide Mage: pay the optional [Accelerate] additional cost [1][Mind] at play time and let the unit enter " +
    "ready instead of exhausted (CR 805.2.b / 805.6) — the KeywordDef is merged but the cost pipeline (RIFT-89) and the " +
    "delayed entry replacement are not wired into production play"
);

test.todo(
  "rad-058-167 Riptide Mage: fire the card-played trigger from the real chain flow (CR 420.4.a) — depends on RIFT-120"
);
