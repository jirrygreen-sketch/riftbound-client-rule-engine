import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/laurent-duelist.js";

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /[Aa]ssault/);
  assert.equal(program.sourceText, "[Assault 2] (+2 :rb_might: while I'm an attacker.)");
});

test("abilities: exactly one Assault keyword ability with value 2", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "keyword");
  assert.equal(ability.keyword, "assault");
  assert.equal(ability.value, 2);
});

test.todo(
  "Assault 2 expansion: +2 Might static effect while an attacker (CR 807; keywords/assault.ts " +
    "owned by RIFT-8x keyword workstream, needs continuous.might + attacker predicate)"
);
