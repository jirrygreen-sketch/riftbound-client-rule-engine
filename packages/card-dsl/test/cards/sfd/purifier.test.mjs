// RIFT-667 single-card golden: validation, identity, the key IR structure of
// Purifier, and the merged keyword-grant half. The whole-card execution evidence
// (its own scenario through the generic card harness plus the measured outcome of
// binding its own static ability with the production binder) lives in
// `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: layers/engine.ts only records the granted keyword
// characteristic, nothing expands a granted keyword through
// effects/keywords/Assault.ts, and there is no 718.3 Attached-card propagation
// bridge. Nothing here approximates the printed +1 Might.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/purifier.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID = "card.hash-d6988e3c4bfaf3cd84e8451ade514abc99df9e47acaa479d8e17bd78b14d1db5";
const SOURCE_TEXT =
  "Your Equipment each give [Assault]. (+1 :rb_might: while equipped unit is an attacker.)";
const [grant] = program.abilities;

test("sfd-183-221 Purifier: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CANONICAL_ID), program);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-183-221 Purifier: one static ability granting a keyword to your Equipment on the Board", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  // 807.1 / 807.1.a: Assault is granted through a characteristic-changing
  // continuous effect, never a chain item.
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "Assault");
  // 807.1.b.3: the printed Assault has no value, so none is declared.
  assert.equal(grant.effect.keywordValue, undefined);
  assert.equal(grant.effect.value, undefined);
  // 818.1.a / 718.5.a: "Equipment" is a Gear tag; 190.6.d: "your" is the
  // ability controller.
  assert.deepEqual(grant.effect.filter, { zone: "board", controller: "controller", tags: ["Equipment"] });
  assert.equal(grant.condition, undefined);
});

test("sfd-183-221 Purifier: the granted keyword id is the merged Assault definition", () => {
  const definition = keywordDefinitionsById.get(grant.effect.keyword);
  assert.ok(definition, "the granted KeywordId must be registered");
  assert.equal(definition.keyword, "Assault");
  // 807.2: valued, and multiple Assaults on one unit sum.
  assert.equal(definition.valued, true);
  assert.equal(definition.stacking, "sum");
  assert.ok(definition.ruleRefs.includes("807.1.c"));
});

test("sfd-183-221 Purifier: the production binder grants Assault to your Equipment only", () => {
  const { engine } = fixture({ cards: [] });
  const source = {
    ref: { id: "purifier", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "purifier",
    types: ["legend"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    combatRole: null,
    might: null,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const handle = createEngineStaticBinder(engine).bindStatic(grant, source);
  const object = (id, extra) => ({
    ...source, ref: { id, zoneEntryId: 1 }, name: id, types: ["gear"], tags: ["Equipment"], ...extra
  });
  const mine = object("blade", { owner: "A", controller: "A" });
  const theirs = object("enemy-blade", { owner: "B", controller: "B" });
  const plain = object("rig", { tags: [] });
  engine.layers.setObjects([mine, theirs, plain]);
  // 818.1.a / 718.5.a: only your Equipment-tagged Gear qualifies.
  assert.deepEqual(engine.layers.snapshot(mine.ref).keywords.map(keyword => keyword.id), ["Assault"]);
  assert.deepEqual(engine.layers.snapshot(theirs.ref).keywords, []);
  assert.deepEqual(engine.layers.snapshot(plain.ref).keywords, []);
  handle.unbind();
  assert.deepEqual(engine.layers.snapshot(mine.ref).keywords, []);
});

test("sfd-183-221 Purifier: judgeReason names the measured expansion gaps", () => {
  // Re-probed 2026-10-17 (RIFT-667): the grant really happens and really is
  // Equipment-scoped, but it produces no Might anywhere.
  assert.match(program.judgeReason, /KeywordDef/);
  assert.match(program.judgeReason, /Assault/);
  assert.match(program.judgeReason, /718\.3/);
});

test.todo(
  "sfd-183-221 Purifier: the granted Assault must give the equipped unit +1 Might while it is an attacker " +
    "(CR 807.1.c) - nothing reads a granted keyword and applies effects/keywords/Assault.ts's expansion"
);
test.todo(
  "sfd-183-221 Purifier: 718.3 propagation of the granted Assault from the attached card to its equipped unit " +
    "- no executable bridge exists"
);
