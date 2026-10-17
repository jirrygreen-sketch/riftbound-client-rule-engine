import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/alpha-wildclaw.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-d607ab71a12af3a735123e958143ee249c28c5acdc5a7f29812a4e46de002d6f";
const SOURCE_TEXT =
  "[Tank] (I must be assigned combat damage first.)\n" +
  "Your units here with less Might than me can't be chosen by enemy spells and abilities.";

const [tank, untargetable] = program.abilities;

test("unl-057-219 Alpha Wildclaw: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-057-219 Alpha Wildclaw: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /757/);
  assert.match(program.judgeReason, /758/);
  assert.match(program.judgeReason, /mightLt/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.doesNotMatch(program.judgeReason, /没有对应原语|没有.*static.*binder/);
});

test("unl-057-219 Alpha Wildclaw: [Tank] is declared as a keyword only (815.1)", () => {
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  assert.equal(tank.value, undefined);
});

test("unl-057-219 Alpha Wildclaw: the untargetability is declared as a static restriction with the here/less-Might filter (757.1)", () => {
  assert.equal(untargetable.kind, "static");
  assert.equal(untargetable.effect.kind, "continuous.restrict");
  assert.equal(untargetable.effect.operation, "choose-as-target");
  assert.equal(untargetable.effect.forbidden, true);
  assert.equal(untargetable.effect.chooser, "opponent");
  assert.equal(untargetable.effect.appliesTo, "spells-and-abilities");
  assert.deepEqual(untargetable.effect.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    sameLocationAs: "self",
    // "with less Might than me": a relational comparison against the source; the
    // merged matcher ignores this key, so it is a predicate name only.
    mightLt: { kind: "self" }
  });
  assert.equal(untargetable.condition, undefined);
});

test.todo(
  "unl-057-219 Alpha Wildclaw: bind continuous.restrict and make target legality consume the Untargetable rule " +
    "(CR 756/757/757.1/758, 355.9.b) — the current static binder rejects the source-relative mightLt filter"
);

test.todo(
  "unl-057-219 Alpha Wildclaw: evaluate 'with less Might than me' as a relational targeting restriction " +
    "(CR 355.9.b; 758.2.a uses this card as its example) — the RIFT-359 relation predicate and its " +
    "source-relative effective-Might query are still missing"
);

test.todo(
  "unl-057-219 Alpha Wildclaw: apply [Tank]'s damage-assignment priority (CR 815.1.b/815.1.c) in the combat " +
    "damage step — the Tank expansion is merged but has no combat consumer"
);
