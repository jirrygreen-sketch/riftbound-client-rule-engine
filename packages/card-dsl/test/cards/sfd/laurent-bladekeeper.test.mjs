import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/laurent-bladekeeper.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import movement from "../../../../engine-core/dist/effects/instructions/continuous.movement.js";
import { movement as movementQuery } from "../../../../engine-core/dist/layers/rules/query.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

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
  assert.match(program.judgeReason, /RIFT-258/);
  assert.match(program.judgeReason, /query/);
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

test("sfd-096-221 Laurent Bladekeeper: expandProgram resolves the declaration into the movement expansion", () => {
  const snapshot = {
    ref: { id: "bladekeeper", zoneEntryId: 1 },
    cardId: CARD_ID,
    name: "Laurent Bladekeeper",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 3,
    energy: 3,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const expanded = expandProgram(program, snapshot);
  assert.equal(expanded.expanded.length, 1);
  assert.equal(expanded.expanded[0].kind, "static");
  assert.equal(expanded.expanded[0].effect.kind, "continuous.movement");
});

test("sfd-096-221 Laurent Bladekeeper golden: the merged permission registers and the movement query reads it", () => {
  // 810.1.b/810.1.c: the expansion grants the Battlefield→Battlefield standard
  // move permission. RIFT-258's instruction registers the ability-layer effect
  // and layers/rules/query.ts's movement() reads it as canGank.
  const kernel = world()
    .unit("bladekeeper", { cardId: CARD_ID, types: ["unit"], might: 3, location: { type: "base", player: "A" } })
    .build();
  const expansion = expandProgram(program, kernel.getObject("bladekeeper")).expanded[0];
  const context = kernel.clone({ source: kernel.ref("bladekeeper"), sourceSnapshot: kernel.getObject("bladekeeper"), controller: "A" });
  const args = Object.fromEntries(
    Object.entries(expansion.effect)
      .filter(([key]) => key !== "kind")
      .map(([key, value]) => [key, { kind: "constant", value }])
  );
  const run = runInstruction(movement, args, { world: context, source: "self" });

  assert.equal(run.result.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  const layers = createLayerEngine(context.objects, context.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 })));
  const view = movementQuery(layers.registry, context.ref("bladekeeper"), context.getObject("bladekeeper"), "A");
  assert.equal(view.canGank, true);
  assert.deepEqual(view.permissions.map((permission) => permission.routes), [["battlefield-to-battlefield"]]);
});

test.todo(
  "sfd-096-221 Laurent Bladekeeper: the registered continuous.movement permission must reach the Standard " +
    "Move so a battlefield-to-battlefield move is legal (810.1.b/810.1.c, 144.4.c.1) — zones/movement.ts " +
    "now reads ruleView.canGank from the movement query, but the Ganking expansion emits a permission " +
    "string while the movement query reads record(permission).routes, so the string shape still yields " +
    "an empty route record and canGank stays false; a shape adapter plus card-program wiring is needed"
);

test.todo(
  "sfd-096-221 Laurent Bladekeeper: register the card's keyword declaration with the trigger/chain pipeline " +
    "(contract 3.5/3.7) so the permission is installed when the unit enters the Board — attachProgramLifecycle " +
    "now binds statics into the layers by default (createEngineStaticBinder); the remaining work is the " +
    "permission-string to route-record adapter described above"
);
