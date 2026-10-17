import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/captain-farron.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-89422400a305aba2968956c639368704e17bca94d650b959b1c78453e5095fe2";
const [aura] = program.abilities;

test("captain-farron: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("captain-farron: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The static binder exists; the remaining gaps are dynamic exclusion and
  // the unevaluated designation/compare condition.
  assert.match(program.judgeReason, /programs\/statics\.ts/);
  assert.match(program.judgeReason, /other|exclude/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /807\.1\.c/);
  assert.match(program.judgeReason, /conditionMatches|compare/);
  assert.equal(
    program.sourceText,
    "Other friendly units here have [Assault]. (+1 :rb_might: while they're attackers.)"
  );
});

test("captain-farron: a single static aura grants Assault to other friendly units at the same location (364.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(aura.kind, "static");
  assert.equal(aura.condition, undefined);
  assert.equal(aura.effect.kind, "continuous.grant-keyword");
  // 807.1.b.3: the printed grant carries no value, so Assault is presumed 1.
  assert.equal(aura.effect.keyword, "assault");
  assert.equal(aura.effect.value, undefined);
  assert.deepEqual(aura.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    other: true,
    sameLocationAs: "self"
  });
});

test("captain-farron: the aura excludes its own source and does not restrict itself to a battlefield", () => {
  const filter = aura.effect.filter;
  assert.equal(filter.other, true, "'Other friendly units' excludes Captain Farron itself");
  // "here" is a location anchor, not a target filter; the card text does not
  // name battlefields, so the aura is not narrowed to battlefield locations.
  assert.equal(filter.location, undefined);
  assert.equal(filter.tag, undefined);
});

test("captain-farron: the aura records the location anchor and the other-object exclusion as selectors", () => {
  // "here" is a source-relative location anchor and "other friendly units"
  // excludes the host. The binder resolves the location anchor, but its
  // production filter translator still rejects the dynamic exclusion.
  assert.deepEqual(aura.effect.filter.sameLocationAs, "self");
  assert.equal(aura.effect.filter.other, true);
  assert.equal(aura.effect.filter.zone, "board");
  assert.equal(aura.effect.filter.type, "unit");
});

test.todo(
  "captain-farron: make static filter translation consume the other/exclude anchor so the " +
    "CardProgram aura registers exactly the same-location units while excluding its host"
);
test.todo(
  "captain-farron: the granted Assault must be re-checked while each unit holds the Attacker designation (807.1.c/807.1.d.1)"
);
