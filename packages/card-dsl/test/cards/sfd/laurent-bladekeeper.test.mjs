import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/laurent-bladekeeper.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CARD_ID = "card.hash-d7b135744e67346532eafa70ee68b6299b7a78117c7e704b524f1c7c3c538d72";

test("sfd-096-221 Laurent Bladekeeper: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-096-221 Laurent Bladekeeper: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "Ganking (I can move from battlefield to battlefield.)");
});

test("sfd-096-221 Laurent Bladekeeper: judgeReason names the movement-permission consumer gap", () => {
  assert.match(program.judgeReason, /810\.1\.b/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /zones\/movement\.ts/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("sfd-096-221 Laurent Bladekeeper: one unvalued Ganking keyword and nothing else", () => {
  // 810.1/810.1.a: Ganking is a Passive Ability keyword on Units. The reminder
  // parentheses are the keyword's rule text, so no instruction is authored.
  assert.deepEqual(program.abilities, [{ kind: "keyword", keyword: "ganking" }]);
  assert.equal(program.abilities[0].value, undefined);
});

test("sfd-096-221 Laurent Bladekeeper: the declared keyword resolves to the merged Ganking expansion", () => {
  // RIFT-83's KeywordDef is registered and expands to the merged
  // continuous.movement static permission (810.1.b/810.1.c). The card only
  // declares the keyword; it never restates the movement rule.
  const definition = keywordDefinitionsById.get("Ganking");
  assert.equal(definition, ganking);
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "single");
  const expansion = definition.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].kind, "static");
  assert.equal(expansion[0].effect.kind, "continuous.movement");
  assert.equal(expansion[0].effect.permission, "battlefield-to-battlefield");
  assert.equal(expansion[0].effect.move, "standard");
  assert.equal(expansion[0].effect.addsPermission, true);
});

test.todo(
  "sfd-096-221 Laurent Bladekeeper: the Ganking expansion's continuous.movement (RIFT-83) must reach the " +
    "movement system so a battlefield-to-battlefield Standard Move is legal (810.1.b/810.1.c, 144.4.c.1) — " +
    "zones/movement.ts still reads only its caller-supplied hasGanking evaluator, and registering the " +
    "keyword's own expansion leaves MovementPermissions.canGank false (the expansion writes " +
    "permission/addsPermission, while the ability layer reads effect.movement for canGank), so no " +
    "CardProgram -> keyword -> layer permission path exists (RIFT-91)"
);

test.todo(
  "sfd-096-221 Laurent Bladekeeper: register the card's keyword declaration with the trigger/chain pipeline " +
    "(contract 3.5/3.7) so the permission applies to the unit on the board (RIFT-120 follow-up)"
);
