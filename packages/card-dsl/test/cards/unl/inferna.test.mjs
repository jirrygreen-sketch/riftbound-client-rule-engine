import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/inferna.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-90eefb9ab8b0769620abebf96a6feb3bfd91535bf652b0311542f4d61d68a2e7";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "[Assault 2] (+2 :rb_might: while I'm an attacker.)";
const HOST = { canonicalCardId: CANONICAL_ID };

test("unl-002-219 Inferna: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-002-219 Inferna: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: name the missing keyword, the rule and the dependent task.
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822\.1\.b/);
  assert.match(program.judgeReason, /RIFT-84/);
  assert.match(program.judgeReason, /combatRole/);
});

test("unl-002-219 Inferna: Ambush keyword plus a valued Assault 2 declaration", () => {
  assert.equal(program.abilities.length, 2);
  // 822.1 / 822.1.a: Ambush is a Passive Ability keyword, normally on Units, and
  // it carries no value (822 has no numeric form).
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "ambush" });
  assert.equal(program.abilities[0].value, undefined);
  // 807.1.b.1-2: the printed "Assault 2" fixes the Assault Value at 2.
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "assault", value: 2 });
});

test("unl-002-219 Inferna: the declared Assault keyword resolves to the merged KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Assault");
  assert.ok(registered, "effects/keywords/Assault.ts must be in the generated keyword registry");
  assert.equal(registered, assault);
  // Card IR uses the lowercase keyword id; the registry is keyed by the printed name.
  assert.equal(program.abilities[1].keyword, registered.keyword.toLowerCase());
  // 807.2: same-named keywords from several sources sum into one Assault Value.
  assert.equal(registered.stacking, "sum");
  assert.ok(registered.ruleRefs.includes("807.1.c"));
  assert.ok(registered.ruleRefs.includes("807.1.d.1"));
});

test("unl-002-219 Inferna: the Assault 2 expansion is +2 Might gated on the Attacker designation", () => {
  const expansion = assault.expand({ value: program.abilities[1].value, host: HOST });
  assert.equal(expansion.length, 1);
  const [ability] = expansion;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
  // 807.1.c / 807.1.d.1: only while the Unit holds the Attacker designation.
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.left.kind, "object-property");
  assert.equal(ability.condition.left.object, "self");
  assert.equal(ability.condition.left.property, "designation");
  assert.equal(ability.condition.operator, "eq");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "attacker" });
});

test("unl-002-219 Inferna: the expanded Assault ability validates as EffectIR for this identity", () => {
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: assault.expand({ value: program.abilities[1].value, host: HOST }),
    sourceText: program.sourceText
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test("unl-002-219 Inferna: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "unl-002-219 Inferna: expand [Ambush] (CR 822.1.b/.c) — the battlefield-where-you-control-Units play " +
    "location and the Reaction permission for that play only; effects/keywords/Ambush.ts is not merged (RIFT-84)"
);

test.todo(
  "unl-002-219 Inferna: apply Assault 2 as +2 Might exactly while the unit holds the Attacker designation " +
    "(CR 807.1.c / 807.1.d.1) — no merged producer resolves a card's keyword abilities into KeywordDef " +
    "expansions and registers them through layers (RIFT-81 / RIFT-91), and the Attacker designation is not an " +
    "ObjectSnapshot characteristic (contract 3.8 combatRole)"
);
