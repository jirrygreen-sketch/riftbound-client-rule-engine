import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ksante-dauntless.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-5d66044d59f3bf4f17b4143a7229c8e12673e34e92591de0005f64fad8dd2a82";
const SOURCE_TEXT =
  "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
  "When I attack or defend, double the [Shield] of a unit you control here this turn.";

const [keyword, attackAbility, defendAbility] = program.abilities;
const [attackInstruction] = attackAbility.body;
const [defendInstruction] = defendAbility.body;

test("rad-045-167 K'Sante, Dauntless: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-045-167 K'Sante, Dauntless: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /designation/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-045-167 K'Sante, Dauntless: unvalued Shield keyword (814.1.b.3 default 1)", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "shield" });
  assert.equal(keyword.value, undefined);
  // RIFT-81 已合入 Shield KeywordDef，展开会消费这个声明。
  assert.equal(keywordDefinitionsById.get("Shield")?.keyword, "Shield");
  assert.equal(keywordDefinitionsById.get("Shield")?.valued, true);
});

test("rad-045-167 K'Sante, Dauntless: one trigger per combat designation (383.4.e / 383.4.f)", () => {
  assert.equal(attackAbility.kind, "triggered");
  assert.equal(attackAbility.trigger.at, "attack-declared");
  assert.deepEqual(attackAbility.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackAbility.optional, false);

  assert.equal(defendAbility.kind, "triggered");
  assert.equal(defendAbility.trigger.at, "defense-declared");
  assert.deepEqual(defendAbility.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self" }
  });
  assert.equal(defendAbility.optional, false);
});

test("rad-045-167 K'Sante, Dauntless: both bodies declare doubling the Shield of a unit you control here, this turn", () => {
  for (const [instruction, expectedId] of [
    [attackInstruction, "ksante-dauntless.attack"],
    [defendInstruction, "ksante-dauntless.defend"]
  ]) {
    assert.equal(instruction.id, expectedId);
    // 814.1.b 的 Shield Value 倍增：arithmetic 层的乘 2（本回合到期）。
    assert.equal(instruction.op, "continuous.might");
    assert.deepEqual(instruction.args.mode, { kind: "constant", value: "multiply" });
    assert.deepEqual(instruction.args.layer, { kind: "constant", value: "arithmetic" });
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
    assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
    assert.deepEqual(instruction.args.objects, {
      kind: "constant",
      value: { kind: "target", id: "ksante-dauntless.unit-here" }
    });
    assert.deepEqual(instruction.targets, [
      {
        id: "ksante-dauntless.unit-here",
        filter: {
          type: "unit",
          controller: "controller",
          zone: "board",
          sameLocationAs: "self"
        },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]);
    assert.equal(instruction.linkedTo, undefined);
  }
});

test.todo(
  "rad-045-167 K'Sante, Dauntless: evaluate Shield 1 while K'Sante is a defender (CR 814.1.c/814.1.d.1) — " +
    "needs the card static → layer registration path (RIFT-257 + RIFT-91), the defender designation " +
    "characteristic (contract 3.8 combatRole) and a condition evaluator that does not treat unknown " +
    "conditions as true (layers/engine.ts conditionMatches)"
);

test.todo(
  "rad-045-167 K'Sante, Dauntless: double the chosen unit's Shield value for the rest of the turn (814.2) and " +
    "expire it at the end-of-turn cleanup — needs a continuous instruction that multiplies a keyword value " +
    "(merged continuous.might rejects multiply/layer args and only add/sets Might)"
);
