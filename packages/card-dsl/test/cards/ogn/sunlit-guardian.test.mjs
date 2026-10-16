import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/sunlit-guardian.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL =
  "card.hash-0386094f508d9cbd2f5fca31e0757380fa1c42cf0e9124b48b8a32d75b9fddc4";
const SOURCE_TEXT =
  "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
  "[Tank] (I must be assigned combat damage first.)";

test("ogn-054-298 Sunlit Guardian: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("ogn-054-298 Sunlit Guardian: identity, ruleset, status, judgeReason and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /815/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-054-298 Sunlit Guardian: exactly Shield and Tank keyword declarations, nothing else", () => {
  // Contract 3.1/3.7 + README section 5: the card only declares keywords; any
  // expansion belongs to effects/keywords/<keyword>.ts. The reminder text is
  // the printed explanation of the keyword, not a separate instruction.
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities, [
    { kind: "keyword", keyword: "shield" },
    { kind: "keyword", keyword: "tank" }
  ]);
  assert.equal(program.abilities[0].value, undefined);
  assert.equal(program.abilities[1].value, undefined);
});

test("ogn-054-298 Sunlit Guardian: the program adds no invented static effect for the keywords", () => {
  // Guard against approximating the [Shield] +1 Might with a hand-written
  // static ability (the printed value is 1 per 814.1.b.3, but its gate needs the
  // defender designation of 814.1.d.1, which is not merged).
  for (const ability of program.abilities) {
    assert.equal(ability.kind, "keyword");
    assert.equal("effect" in ability, false);
    assert.equal("body" in ability, false);
    assert.equal("trigger" in ability, false);
    assert.equal("condition" in ability, false);
  }
});

test.todo(
  "ogn-054-298 Sunlit Guardian: [Shield] (814) needs the keyword expansion (static " +
    "continuous.might, +1 while the host is a defender, 814.1.c/814.1.d.1) registered into the " +
    "layers engine, plus the defender designation characteristic (contract 3.8 combatRole, not " +
    "yet in engine-core's effects/contract.ts) — RIFT-91 layers-continuous, RIFT-81"
);

test.todo(
  "ogn-054-298 Sunlit Guardian: [Tank] (815) needs a Tank KeywordDef and the combat damage " +
    "assignment priority (815.1.b/815.1.c.2); merged combat/base-combat-allocation.ts binds no " +
    "assignment-priority requirement — combat allocation workstream"
);
