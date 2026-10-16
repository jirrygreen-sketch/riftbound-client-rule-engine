import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ancient-warmonger.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";

const CANONICAL = "card.hash-3657fb1a42b929920135ba38e292bf53fa1112a145cf12bb352cd750e3b64e60";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
  "I have [Assault] equal to the number of enemy units here. (+1 :rb_might: while I'm an attacker for each instance of Assault.)";

const [keyword, grantedAssault] = program.abilities;

test("sfd-131-221 Ancient Warmonger: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-131-221 Ancient Warmonger: judgeReason names the dynamic-grant and designation gaps", () => {
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /addContinuous/);
  assert.match(program.judgeReason, /807\.1\.d/);
  assert.match(program.judgeReason, /combatRole\/designation/);
  assert.match(program.judgeReason, /805/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("sfd-131-221 Ancient Warmonger: [Accelerate] is declared, not expanded", () => {
  // 805.1.b: Accelerate's cost is fixed at 1 energy + 1 power, so the keyword
  // carries no value; 805.4 makes multiple instances redundant.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "accelerate" });
  assert.equal(keyword.value, undefined);
  assert.equal(accelerate.keyword, "Accelerate");
  assert.equal(accelerate.valued, false);
  assert.equal(accelerate.stacking, "single");
  assert.ok(accelerate.ruleRefs.includes("805.1.b"));
  assert.ok(accelerate.ruleRefs.includes("805.6.a"));
});

test("sfd-131-221 Ancient Warmonger: 'I have Assault equal to the number of enemy units here' is a dynamic self-grant", () => {
  assert.equal(grantedAssault.kind, "static");
  assert.equal(grantedAssault.effect.kind, "continuous.grant-keyword");
  assert.equal(grantedAssault.effect.appliesTo, "self");
  // 807.1.b.2 / 807.3: the granted Assault's value is a readable characteristic.
  assert.equal(grantedAssault.effect.keyword, "assault");
  // "the number of enemy units here": a dynamic count, not a printed constant.
  // sameLocationAs binds the source's own Location (421.1) and controller
  // "opponent" is CR 740.1.b's enemy.
  assert.deepEqual(grantedAssault.effect.value, {
    kind: "count",
    subject: "units",
    filter: {
      type: "unit",
      controller: "opponent",
      zone: "board",
      sameLocationAs: "self"
    }
  });
  assert.equal(grantedAssault.condition, undefined);
  // The value must never be frozen into a printed Assault N.
  assert.equal(grantedAssault.effect.value.kind === "constant", false);
});

test("sfd-131-221 Ancient Warmonger: the printed Assault keyword is NOT declared as a fixed value", () => {
  // 807.1.c reminder text is the explanation of Assault, not a second ability;
  // a { kind: "keyword", keyword: "assault", value: N } entry here would freeze
  // the dynamic count and is therefore absent.
  assert.equal(
    program.abilities.some((ability) => ability.kind === "keyword" && ability.keyword === "assault"),
    false
  );
  // The merged Assault expansion itself is present and layers-owned (807.1.c).
  assert.equal(assault.keyword, "Assault");
  assert.equal(assault.stacking, "sum");
  assert.ok(assault.ruleRefs.includes("807.1.c"));
});

test.todo(
  "sfd-131-221 Ancient Warmonger: grant [Assault] to this unit at a dynamic value through " +
    "continuous.grant-keyword and the layers engine, active only while it holds the Attacker " +
    "designation (807.1.c/807.1.d/807.1.d.1, contract 3.8 combatRole) — RIFT-91 layers-continuous, " +
    "plus the RIFT-81 keyword expansion consumer"
);

test.todo(
  "sfd-131-221 Ancient Warmonger: the printed [Accelerate] optional additional cost (1 energy + 1 " +
    "Chaos power, 805.1.b/805.1.b.1) and its delayed enter-ready replacement (805.2.b/805.6/805.6.a) " +
    "need the Finalize optional-additional wiring and the replacement.enter consumer — RIFT-89 / RIFT-91"
);
