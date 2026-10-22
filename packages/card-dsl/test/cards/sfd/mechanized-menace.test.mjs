import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import mechanizedMenace from "../../../dist/cards/sfd/mechanized-menace.js";

test("sfd-181-221 Mechanized Menace: program passes validateCardProgram", () => {
  const result = validateCardProgram(mechanizedMenace);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-181-221 Mechanized Menace: identity and status", () => {
  assert.equal(
    mechanizedMenace.canonicalCardId,
    "card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7"
  );
  assert.equal(mechanizedMenace.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(mechanizedMenace.status, "judge-required");
  assert.match(mechanizedMenace.judgeReason, /Legend 区/);
  assert.match(mechanizedMenace.judgeReason, /createMatch/);
  assert.match(mechanizedMenace.judgeReason, /CR 814\.1\.c/);
});

test("sfd-181-221 Mechanized Menace: single static keyword-grant ability", () => {
  assert.equal(mechanizedMenace.abilities.length, 1);
  const ability = mechanizedMenace.abilities[0];
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "grant-keyword");
  assert.equal(ability.effect.keyword, "shield");
  // Shield without a printed value presumes X = 1 (CR 814.1.b.3).
  assert.deepEqual(ability.effect.value, { kind: "constant", value: 1 });
  // The grant covers every Mech unit the legend's controller controls.
  assert.equal(ability.effect.filter.type, "unit");
  // Tags are case-sensitive; the catalog and the CR 187.4 Mech token use "Mech".
  assert.equal(ability.effect.filter.tag, "Mech");
  assert.equal(ability.effect.filter.controller, "controller");
  assert.equal(ability.effect.filter.zone, "board");
  assert.equal(ability.condition, undefined);
});

test("sfd-181-221 Mechanized Menace: sourceText is the printed ability text", () => {
  assert.equal(
    mechanizedMenace.sourceText,
    "Your Mechs have [Shield]. (+1 :rb_might: while they're defenders.)"
  );
});

// --- Production component goldens. The original registry program is bound by
// createProgramBinding and the Legend enters its public Legend Zone through a
// real create-token action so the lifecycle binds its static. The engine-core
// RIFT-891 suite also proves createMatch placement and live activation.
//
// The card is judge-required, so the binding receives a component view that
// admits only the status metadata; abilities, filter and tag are the unchanged
// registry IR. These tests prove the grant, not the in-match Legend placement.
const admitted = { ...mechanizedMenace, status: "executable", judgeReason: undefined };
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { getTokenDefinition } from "../../../../engine-core/dist/effects/tokens/definitions.js";

function legendInZone() {
  const kernel = world().player("A").player("B")
    .base("mech", { might: 3, tags: ["Mech", "Yordle"] })
    .base("plain", { might: 3, tags: ["Yordle"] })
    .unit("enemy-mech", { owner: "B", controller: "B", might: 3, tags: ["Mech"], location: { type: "base", player: "B" } })
    .build();
  const choose = request => { throw new Error(`Unexpected production choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  binding.attachLifecycle(engine, error => { throw error; });
  const created = engine.commit({ type: "create-token", player: "A", to: "legend", token: {
    cardId: mechanizedMenace.canonicalCardId, name: "Mechanized Menace", types: ["legend"], tags: ["Rumble"],
    championLegend: true,
    keywords: [], might: null, energy: null, power: null,
  } });
  assert.equal(created.status, "done");
  const shield = id => {
    engine.layers.setObjects(kernel.objects);
    return engine.layers.evaluate(kernel.ref(id)).keywords.filter(keyword => keyword.id.toLowerCase() === "shield");
  };
  return { kernel, engine, shield, legend: created.result };
}

test("sfd-181-221 Mechanized Menace grants Shield 1 only to its controller's Mechs", () => {
  const f = legendInZone();
  assert.deepEqual(f.shield("mech").map(keyword => keyword.value), [1]);
  assert.deepEqual(f.shield("plain"), [], "a friendly non-Mech is unaffected");
  assert.deepEqual(f.shield("enemy-mech"), [], "an opposing Mech is unaffected");
});

test("sfd-181-221 Mechanized Menace reaches the CR 187.4 Mech token's real tag", () => {
  const mechToken = getTokenDefinition("mech");
  assert.ok(mechToken, "the frozen Mech token definition exists");
  assert.ok(mechToken.spec.tags.includes(mechanizedMenace.abilities[0].effect.filter.tag));
});

test("sfd-181-221 Mechanized Menace keeps a Champion Legend and its Shield grant in Legend", () => {
  const f = legendInZone();
  assert.equal(f.shield("mech").length, 1);
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref(f.legend.id), to: "banishment" }).status, "prevented");
  assert.equal(f.shield("mech").length, 1);
  assert.equal(f.kernel.getObject(f.legend.id).zone, "legend");
});

test.todo("sfd-181-221 Mechanized Menace: a granted Shield gives +1 Might while the Mech is a defender in real combat (CR 814.1.c)");
