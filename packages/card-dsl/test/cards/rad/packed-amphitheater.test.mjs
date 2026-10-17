import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/packed-amphitheater.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL =
  "card.hash-7e95acea2b29696bcdb29e7def854dacdbb55f72f5160fb4bc3e9c872950af6e";
const SOURCE_TEXT = "Champion units here have +1 :rb_might:.";

function board(f, id, location = { type: "battlefield", id: "battlefield-1" }) {
  f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "battlefield", location });
}

test("rad-164-167 Packed Amphitheater: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-164-167 Packed Amphitheater: identity, executable status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-164-167 Packed Amphitheater: one static arithmetic +1 Might for Champion units here", () => {
  const [ability] = program.abilities;
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(ability.effect.filter, {
    type: "champion",
    zone: "board",
    sameLocationAs: "self"
  });
});

test("rad-164-167 Packed Amphitheater: program binding applies the aura only to Champion units at this Battlefield", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const f = fixture({
    cards: [
      { id: "amphitheater", cardId: CANONICAL, types: ["battlefield"], might: null, energy: null, power: null },
      { id: "champion-here", types: ["champion", "unit"], might: 3 },
      { id: "champion-away", types: ["champion", "unit"], might: 3 },
      { id: "plain-here", types: ["unit"], might: 3 }
    ],
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(f.engine);

  board(f, "amphitheater");
  board(f, "champion-here", { type: "battlefield", id: "battlefield-1" });
  board(f, "champion-away", { type: "battlefield", id: "battlefield-2" });
  board(f, "plain-here", { type: "battlefield", id: "battlefield-1" });
  f.engine.layers.setObjects(f.kernel.objects);

  const [registered] = f.engine.layers.registry.list();
  assert.equal(registered.effect.effect.kind, "continuous.might");
  // The binding resolves sameLocationAs to the source's concrete location.
  // Evaluate the registered spec with that resolved location object so the
  // layer filter compares the authoritative location identity.
  const championHere = {
    ...f.kernel.getObject("champion-here"),
    location: registered.effect.filter.location
  };
  const championAway = {
    ...f.kernel.getObject("champion-away"),
    location: { type: "battlefield", id: "battlefield-2" }
  };
  const plainHere = {
    ...f.kernel.getObject("plain-here"),
    location: registered.effect.filter.location
  };
  const layerEngine = createLayerEngine([championHere, championAway, plainHere], [registered]);
  assert.equal(layerEngine.snapshot(championHere.ref).might, 4);
  assert.equal(layerEngine.snapshot(championAway.ref).might, 3);
  assert.equal(layerEngine.snapshot(plainHere.ref).might, 3);
});

test("rad-164-167 Packed Amphitheater: leaving the Battlefield removes the bound aura", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const f = fixture({
    cards: [
      { id: "amphitheater", cardId: CANONICAL, types: ["battlefield"], might: null, energy: null, power: null },
      { id: "champion", types: ["champion", "unit"], might: 3 }
    ],
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(f.engine);
  board(f, "amphitheater");
  board(f, "champion");
  f.engine.layers.setObjects(f.kernel.objects);
  const [registered] = f.engine.layers.registry.list();
  const champion = { ...f.kernel.getObject("champion"), location: registered.effect.filter.location };
  assert.equal(createLayerEngine([champion], [registered]).snapshot(champion.ref).might, 4);

  f.engine.commit({ type: "kill", object: f.kernel.ref("amphitheater") });
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("champion")).might, 3);
});
