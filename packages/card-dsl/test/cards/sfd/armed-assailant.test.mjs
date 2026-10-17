import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/armed-assailant.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import weaponmaster from "../../../../engine-core/dist/effects/keywords/Weaponmaster.js";

const ID = "card.hash-8518a281524e1e72c165821192f2957a4ce78725737d98dbb03e70569739aec0";

test("sfd-002-221 Armed Assailant: validates, identity and registry", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /Weaponmaster/);
  assert.equal(program.sourceText, "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)");
});

test("sfd-002-221 Armed Assailant: declares both printed keywords", () => {
  assert.deepEqual(program.abilities, [
    { kind: "keyword", keyword: "accelerate" },
    { kind: "keyword", keyword: "weaponmaster" }
  ]);
});

test("sfd-002-221 Armed Assailant: merged keyword expansions exist and stay unexpanded in the card program", () => {
  assert.equal(accelerate.keyword, "Accelerate");
  assert.ok(accelerate.ruleRefs.includes("805.1.b"));
  assert.ok(accelerate.ruleRefs.includes("805.6.a"));
  assert.equal(weaponmaster.keyword, "Weaponmaster");
  assert.ok(weaponmaster.ruleRefs.includes("821.1.c.3"));
  assert.ok(weaponmaster.ruleRefs.includes("821.1.c.2.a"));
  assert.equal(program.abilities.every((ability) => ability.kind === "keyword"), true);
});
