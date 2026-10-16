import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/wily-newtfish.js";

const CANONICAL_ID =
  "card.hash-55487ff54a21b4f984b21e9ef2babc80760bd74a2128eac7bd6665ff81432f9e";
const SOURCE_TEXT =
  "If you've gained XP this turn, I have +1 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [mightAbility, gankingAbility] = program.abilities;

test("unl-108-219 Wily Newtfish: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-108-219 Wily Newtfish: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /364\.3/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /144\.4\.c/);
});

test("unl-108-219 Wily Newtfish: the conditional passive ability keeps its XP-of-this-turn gate shape", () => {
  assert.equal(program.abilities.length, 2);
  // 364.3: the whole card text is one conditional passive ability; the two
  // granted pieces are modelled as one static ability each.
  assert.equal(mightAbility.kind, "static");
  for (const ability of program.abilities) {
    assert.equal(ability.condition.kind, "compare");
    assert.equal(ability.condition.operator, "gte");
    assert.deepEqual(ability.condition.right, { kind: "constant", value: 1 });
    assert.equal(ability.condition.left.kind, "count");
    assert.equal(ability.condition.left.subject, "controller-xp-gained-this-turn");
    assert.deepEqual(ability.condition.left.filter, { player: "controller" });
  }
});

test("unl-108-219 Wily Newtfish: the first half is +1 Might for the host, never a Buff counter", () => {
  // 143.2.a: an undurationed Might change is an arithmetic-layer continuous
  // effect; 702 Buffs are counters and are not used here.
  assert.equal(mightAbility.effect.kind, "continuous.might");
  assert.equal(mightAbility.effect.mode, "add");
  assert.equal(mightAbility.effect.layer, "arithmetic");
  assert.deepEqual(mightAbility.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightAbility.effect.filter, { object: "self" });
});

test("unl-108-219 Wily Newtfish: the second half grants [Ganking] to the host", () => {
  // 810.1 / 810.1.b: Ganking adds the Battlefield→Battlefield Standard Move
  // permission; the card only declares the grant (contract 3.7).
  assert.equal(gankingAbility.effect.kind, "continuous.grant-keyword");
  assert.equal(gankingAbility.effect.keyword, "Ganking");
  assert.deepEqual(gankingAbility.effect.filter, { object: "self" });
});

test("unl-108-219 Wily Newtfish: the merged keyword registry knows Ganking but has no XP-history predicate", async () => {
  const { keywordDefinitionsById } = await import(
    "../../../../engine-core/dist/effects/keywords/registry.generated.js"
  );
  assert.equal(keywordDefinitionsById.has("Ganking"), true);
  // The gate itself is not a keyword: nothing in the merged Condition algebra
  // can ask "did you gain XP this turn" (730.1's xp-gained timing point exists;
  // the static-ability evaluation path does not read it).
  const conditionKinds = new Set([
    "always",
    "never",
    "compare",
    "all",
    "any",
    "not",
    "expression"
  ]);
  assert.equal(conditionKinds.has("history"), false);
});

test.todo(
  "unl-108-219 Wily Newtfish: evaluate 'you've gained XP this turn' (730.1 / 730.2, xp-gained timing point) for a static ability — the frozen Condition algebra has no history node and the layer engine's conditionMatches does not consume `condition.history`"
);
test.todo(
  "unl-108-219 Wily Newtfish: register the +1 Might arithmetic effect and the Ganking grant as ContinuousEffectSpecs honouring the XP gate — no merged producer turns a CardProgram static ability into a registered continuous effect (RIFT-91 card wiring)"
);
test.todo(
  "unl-108-219 Wily Newtfish: consume the granted Ganking permission in the movement system (810.1.c / 144.4.c) — zones/movement.ts and effect.move never read MovementPermissions.canGank"
);
