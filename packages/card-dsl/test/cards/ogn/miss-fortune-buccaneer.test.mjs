import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/miss-fortune-buccaneer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { playLocations } from "../../../../engine-core/dist/layers/rules/query.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const BUCCANEER_ID = "card.hash-713732fef292fb529d388efbec2020949fdfaeca0c39e3afeb5ed43119a7f3e5";

/** A real chain engine so the production static binder runs. */
function engineFor() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .hand("buccaneer", { cardId: BUCCANEER_ID, owner: "A", controller: "A", types: ["unit"], energy: 4, power: [] })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return { engine, kernel };
}

const CANONICAL = "card.hash-713732fef292fb529d388efbec2020949fdfaeca0c39e3afeb5ed43119a7f3e5";
const SOURCE_TEXT =
  "You may play me to an open battlefield.\nFriendly units may be played to open battlefields.";

const [playSelf, friendlyUnits] = program.abilities;

test("miss-fortune-buccaneer: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("miss-fortune-buccaneer: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /continuous\.location/);
  // Restored pre-resweep assertion /binder/.
  assert.match(program.judgeReason, /binder/);
  assert.match(program.judgeReason, /layerFor|playDestinationIsLegal/);
  assert.match(program.judgeReason, /open battlefield/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("miss-fortune-buccaneer: both play-location permissions are still unmappable in the layer binder", () => {
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("buccaneer");
  for (const ability of program.abilities) {
    const error = (() => {
      try {
        createEngineStaticBinder(engine).bindStatic(ability, source);
        return null;
      } catch (thrown) {
        return thrown;
      }
    })();
    assert.ok(error, "the merged layer binder must still refuse play-location-permission");
    assert.equal(error.code, "judge-required");
    assert.match(error.message, /play-location-permission has no layer mapping/);
  }
  assert.deepEqual(engine.layers.registry.list(), []);
});

test("miss-fortune-buccaneer: playLocations only carries the named permission, never the open-battlefield value", () => {
  // The consumable-looking continuous.location shape is ALSO unmappable: the
  // merged layerFor has no location branch, so a rewritten declaration is
  // refused exactly like the card's declared kind.
  const { engine, kernel } = engineFor();
  const source = kernel.getObject("buccaneer");
  const planned = {
    ...program.abilities[0],
    effect: { kind: "continuous.location", permission: "open-battlefield", appliesTo: "self" }
  };
  const error = (() => {
    try {
      createEngineStaticBinder(engine).bindStatic(planned, source);
      return null;
    } catch (thrown) {
      return thrown;
    }
  })();
  assert.ok(error);
  assert.equal(error.code, "judge-required");
  assert.match(error.message, /continuous\.location has no layer mapping/);
  assert.deepEqual(engine.layers.registry.list(), []);

  // And the query itself only exposes permission names, so even a manual
  // registration cannot supply the 170.11.c open-battlefield predicate to
  // playDestinationIsLegal.
  engine.layers.registry.register({
    id: "probe-location",
    layer: "ability",
    source: source.ref,
    filter: { objectId: "buccaneer" },
    effect: { kind: "location", permission: "open-battlefield" }
  }, { type: "permanent" }, 1);
  const view = playLocations(engine.layers.registry, source.ref, source, "A");
  assert.deepEqual(view.permissions.map(permission => permission.name), ["open-battlefield"]);
  assert.equal("occupied" in engine.layers.registry.list()[0].effect.effect, false);
  assert.equal("controlled" in engine.layers.registry.list()[0].effect.effect, false);
});

test("miss-fortune-buccaneer: two static play-location permissions", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(
    program.abilities.map((ability) => ability.kind),
    ["static", "static"]
  );
  assert.deepEqual(
    program.abilities.map((ability) => ability.effect.kind),
    ["play-location-permission", "play-location-permission"]
  );
  assert.deepEqual(
    program.abilities.map((ability) => ability.effect.duration),
    ["while-in-hand", "while-on-board"]
  );
  assert.deepEqual(
    program.abilities.map((ability) => ability.condition),
    [{ kind: "always" }, { kind: "always" }]
  );
});

test("miss-fortune-buccaneer: 'open battlefield' means unoccupied and uncontrolled (CR 170.11.c)", () => {
  assert.equal(playSelf.effect.value.kind, "constant");
  // CR 170.11.a: occupied = 有单位；170.11.b: uncontrolled = 无玩家控制；
  // 170.11.c: open = 两者同时成立。
  assert.deepEqual(playSelf.effect.value.value, {
    zone: "battlefield",
    battlefield: { occupied: false, controlled: false },
    appliesTo: "self"
  });

  // 第一句只给本卡自己（355.2.b）；第二句给本卡控制者的所有友方单位。
  assert.deepEqual(friendlyUnits.effect.value.value, {
    zone: "battlefield",
    battlefield: { occupied: false, controlled: false },
    appliesTo: "friendly-units"
  });
  assert.equal(playSelf.effect.value.value.appliesTo, "self");
});

test.todo(
  "miss-fortune-buccaneer: map play-location-permission to a continuous.location registration and " +
    "consume its open-battlefield value during Finalize"
);

test.todo(
  "miss-fortune-buccaneer: verify an open battlefield (CR 170.11.c: unoccupied and uncontrolled) " +
    "is accepted while an occupied or controlled battlefield stays illegal"
);
