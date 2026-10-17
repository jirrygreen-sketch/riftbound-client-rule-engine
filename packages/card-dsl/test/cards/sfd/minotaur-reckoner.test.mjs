import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/minotaur-reckoner.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const ID = "card.hash-4707dc730254c2d3c4ed3484a961094d03925ec45f647f561ff4b106e7e22ebe";
const ability = program.abilities[0];

test("sfd-014-221 Minotaur Reckoner: validates identity and movement restriction", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /144\.4\.b/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, "Units can't move to base.");
});

test("sfd-014-221 Minotaur Reckoner: layer engine records the global prohibition", () => {
  const kernel = world().unit("minotaur", { location: { type: "battlefield", id: "bf-1" } }).build();
  const object = kernel.getObject("minotaur");
  const engine = createLayerEngine([object], [{
    effect: { id: "minotaur-reckoner", layer: "ability", filter: ability.effect.filter, effect: ability.effect },
    duration: { type: "permanent" },
    timestamp: 1
  }]);
  engine.setObjects([object]);
  assert.deepEqual(engine.evaluate(object.ref).movement.restrictions, ["move-to-base"]);
});

test.todo("Minotaur Reckoner: make Standard Move and effect.move consume the layered move-to-base prohibition (RIFT-75/RIFT-91)");
