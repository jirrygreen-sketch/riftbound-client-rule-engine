import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/veteran-poro.js";

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /[Ww]eaponmaster/);
  assert.ok(program.sourceText.includes("[Weaponmaster]"));
  assert.ok(program.sourceText.includes("even if it's already attached"));
});

test("abilities: exactly one unvalued Weaponmaster keyword ability", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "keyword");
  assert.equal(ability.keyword, "weaponmaster");
  assert.equal(ability.value, undefined);
});

test.todo(
  "Weaponmaster expansion: on play, choose one of your Equipment, pay its Equip cost reduced by " +
    "[A], attach it to me even if already attached (CR 821.1.c; keywords/weaponmaster.ts owned by " +
    "RIFT-8x keyword workstream, needs cost.modify + effect.attach)"
);
