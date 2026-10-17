import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/ki-barrier.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CARD_ID = "card.hash-c7314bf7e9131668bdd7205b5d3fbea9f04822a76c74bdac078317dc203fae52";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a unit. Prevent the next 7 damage that would be dealt to it this turn. " +
  "(Opponents can assign it extra combat damage to kill it.)";

const [reactionKeyword, play] = program.abilities;
const [prevent] = play.body;
const targetSpec = prevent.targets[0];

test("ven-126-166 Ki Barrier: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-126-166 Ki Barrier: judgeReason names replacement registration and the Prevent Value tracking", () => {
  // 438.1/438.1.b.1 Prevent Value, 438.3 decrement, 438.7 delayed replacement.
  assert.match(program.judgeReason, /438\.1/);
  assert.match(program.judgeReason, /438\.3/);
  assert.match(program.judgeReason, /replacement\.prevent/);
  assert.match(program.judgeReason, /duration|期限/);
  assert.match(program.judgeReason, /不近似实现/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120|RIFT-91/);
});

test("ven-126-166 Ki Barrier: [Reaction] plus a prevent declaration over the chosen unit", () => {
  assert.equal(program.abilities.length, 2);
  // 813: the keyword is a pure permission and carries no value.
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["ki-barrier.prevent-7", "replacement.prevent"]
  ]);
  // 438.1.b.1: the Prevent Value is exactly the printed 7; the window is this turn.
  assert.deepEqual(prevent.args, {
    amount: { kind: "constant", value: 7 },
    duration: { kind: "constant", value: "this-turn" },
    target: { kind: "constant", value: "ki-barrier.unit" }
  });
  // "Choose a unit": 355.7/355.9.a.1 one chosen Board unit; the parenthetical is
  // 438.5 reminder text and never a second ability.
  assert.deepEqual(targetSpec, {
    id: "ki-barrier.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(prevent.picks, undefined);
  assert.equal(prevent.linkedTo, undefined);
  assert.equal(prevent.condition, undefined);
});

test("ven-126-166 Ki Barrier: the printed [Reaction] keyword is a registered definition", () => {
  // Positive-only check: the [Reaction] declaration names a real registry entry; the
  // prevention half stays covered by judgeReason and the replacement TODO.
  assert.equal(keywordDefinitionsById.has("Reaction"), true);
  assert.equal(keywordDefinitionsById.get("Reaction").valued, false);
  assert.equal(keywordDefinitionsById.get("Reaction").stacking, "single");
});

test.todo(
  "ven-126-166 Ki Barrier: install the 438.7 delayed damage prevention on the chosen unit and track " +
    "the remaining Prevent Value (438.1.b.1/438.2/438.3) so the next 7 damage is prevented in whole or " +
    "in part — replacement.prevent and unit-level Prevent tracking are absent from the frozen ResolveContext " +
    "and ObjectSnapshot"
);

test.todo(
  "ven-126-166 Ki Barrier: expire the prevention at end of turn (317.2.c) — the contract 3.1 replacement " +
    "ability has no duration field or replacement cleanup hook"
);
