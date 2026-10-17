import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/purifier.js";

// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { createLayerEngine } = await import(new URL("layers/engine.js", ENGINE));
const { matchesObjectFilter } = await import(new URL("layers/filter.js", ENGINE));

const CANONICAL_ID = "card.hash-d6988e3c4bfaf3cd84e8451ade514abc99df9e47acaa479d8e17bd78b14d1db5";
const SOURCE_TEXT =
  "Your Equipment each give [Assault]. (+1 :rb_might: while equipped unit is an attacker.)";

const [grant] = program.abilities;

/** A minimal layered object with the fields the ability layer reads. */
const object = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: `card:${id}`,
  name: id,
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: null,
  might: 2,
  energy: 1,
  power: ["Fury"],
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...values
});

const equipment = (id, values = {}) =>
  object(id, { types: ["gear"], tags: ["Equipment"], might: null, energy: 1, power: null, ...values });

const registration = (filter) => [
  {
    effect: { id: "purifier", layer: "ability", filter, effect: grant.effect },
    duration: { type: "permanent" },
    timestamp: 1
  }
];

test("sfd-183-221 Purifier: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-183-221 Purifier: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // cards/README.md section 2: the reason names the missing pieces, not a vague
  // "not implemented yet".
  assert.match(program.judgeReason, /registerContinuousEffect/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-81/);
  assert.match(program.judgeReason, /assault|Assault/);
});

test("sfd-183-221 Purifier: one static ability granting a keyword to your Equipment on the Board", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  // 807.1.b.3: no printed Assault value, so none is declared and the value
  // defaults to 1; the grant must not invent one.
  assert.equal(grant.effect.value, undefined);
  assert.deepEqual(grant.effect.filter, {
    zone: "board",
    controller: "controller",
    tags: ["Equipment"]
  });
  assert.equal(grant.condition, undefined);
});

test("sfd-183-221 Purifier: the granted keyword id is the merged Assault definition", () => {
  const definition = keywordDefinitionsById.get(grant.effect.keyword);
  assert.ok(definition, "the granted KeywordId must be registered");
  assert.equal(definition.keyword, "Assault");
  // 807: valued, and multiple Assaults on one unit sum (807.2).
  assert.equal(definition.valued, true);
  assert.equal(definition.stacking, "sum");
  assert.ok(definition.ruleRefs.includes("807.1.c"));
});

test("sfd-183-221 Purifier: the Equipment filter selects only Equipment-tagged Gear", () => {
  const attachedBlade = equipment("blade", { attachedTo: { id: "soldier", zoneEntryId: 1 } });
  const plainGear = object("rig", { types: ["gear"], might: null, energy: 2, power: null });
  const enemyBlade = equipment("enemy-blade", { owner: "B", controller: "B" });
  const unit = object("soldier");
  // The visitor-supplied controller value stands in for the production binding of
  // 190.6.d's "you"; the filter itself is executed by the merged matcher.
  const bound = { ...grant.effect.filter, controller: "A" };
  assert.equal(matchesObjectFilter(bound, attachedBlade), true, "your attached Equipment");
  assert.equal(matchesObjectFilter(bound, enemyBlade), false, "not an opponent's Equipment");
  assert.equal(matchesObjectFilter(bound, plainGear), false, "not Gear without the Equipment tag");
  assert.equal(matchesObjectFilter(bound, unit), false, "not a Unit");

  const engine = createLayerEngine([attachedBlade, plainGear, enemyBlade, unit], registration(bound));
  engine.setObjects([attachedBlade, plainGear, enemyBlade, unit]);
  assert.deepEqual(engine.evaluate(attachedBlade.ref).keywords.map((keyword) => keyword.id), ["Assault"]);
  assert.deepEqual(engine.evaluate(plainGear.ref).keywords, []);
  assert.deepEqual(engine.evaluate(enemyBlade.ref).keywords, []);
});

test.todo(
  "sfd-183-221 Purifier: registration of the program's static ability as a layers " +
    "ContinuousEffectSpec, plus binding \"controller\" to the ability's controller " +
    "(registerContinuousEffect has no caller in engine-core; layers/filter.ts resolves only " +
    "self/opponent/any/playerId) — RIFT-91"
);

test.todo(
  "sfd-183-221 Purifier: expansion of the granted Assault into its " +
    "\"while I am an attacker, +1 [M]\" arithmetic static effect (effects/keywords/Assault.ts " +
    "defines the expansion; nothing reads a granted keyword and applies it) — RIFT-81"
);
