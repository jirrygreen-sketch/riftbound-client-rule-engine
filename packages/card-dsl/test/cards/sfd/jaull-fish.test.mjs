import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/jaull-fish.js";

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost.modify/);
  assert.ok(program.sourceText.includes("[Accelerate]"));
  assert.ok(program.sourceText.includes("cost :rb_energy_2: less for each of your [Mighty] units"));
});

test("abilities: exactly one unvalued Accelerate keyword ability", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "keyword");
  assert.equal(ability.keyword, "accelerate");
  assert.equal(ability.value, undefined);
});

test("keyword stays judge-required until its expansion exists", () => {
  // The [Accelerate] keyword is expressed, but its expansion
  // (keywords/accelerate.ts: cost.additional + replacement.enter) is not
  // implemented, so the whole program stays judge-required per contract 1.5.
  assert.equal(program.status, "judge-required");
});

test.todo(
  "Accelerate expansion: optional additional cost {1 energy + 1 Body power} at play time, " +
    "enter-ready replacement (CR 805; keyword file owned by RIFT-8x keyword workstream)"
);

test.todo(
  "'I cost 2 less per Mighty unit' static cost reduction via cost.modify counting controller's " +
    "Mighty units (cost-modify template; primitive owned by RIFT-8x cost workstream)"
);
