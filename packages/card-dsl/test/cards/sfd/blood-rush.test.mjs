// Golden test for Blood Rush (sfd-003-221) — layers 1 and 2 of cards/README §4
// (validation/identity and structure).
//
// Execution evidence (printed base cost, board-unit target, permanent
// ability-layer Assault 2 grant, the declared [Repeat] cost failing closed and
// the Showdown timing query) lives in the parameterized template golden:
// test/cards/templates/keyword-play-continuous-grant-keyword-681.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/blood-rush.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import repeat from "../../../../engine-core/dist/effects/keywords/Repeat.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { abilitySpeed } from "../../../../engine-core/dist/programs/keywords.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-01042b9eeb52d036e7ddeb7a52f785ab5acaf5fc08d6923554a753376d2b7529";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "[Repeat] :rb_energy_1: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Give a unit [Assault 2]. (+2 :rb_might: while it's an attacker.)";

const [speed, play] = program.abilities;
const [grant] = play.body;

test("sfd-003-221 Blood Rush: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-003-221 Blood Rush: judge-required for the keyword grant and the Repeat cost wiring", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /combatRole|designation/);
  assert.match(program.judgeReason, /820\.1\.c\.1/);
  assert.match(program.judgeReason, /KeywordDef|consumer|expand/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.doesNotMatch(program.judgeReason, /non-combat|unconditionally/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("sfd-003-221 Blood Rush structure: [Action] plus the printed Repeat cost", () => {
  // [Action] (806) is the printed speed keyword; the registry owns the
  // Showdown permission (806.1.c / 159.2.a).
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");

  // [Repeat] :rb_energy_1: (820.1.c): the printed additional cost with the
  // explicit pay/decline decision 820.1.b requires.
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.payments.length, 1);
  const [payment] = play.cost.payments;
  assert.equal(payment.kind, "energy");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  assert.equal(payment.choice.id, "blood-rush.repeat-payment");
  assert.deepEqual(payment.choice.options, ["pay", "decline"]);
  assert.equal(payment.choice.selection, "one");
});

test("sfd-003-221 Blood Rush structure: the Assault 2 grant on one chosen unit", () => {
  assert.equal(play.body.length, 1);
  assert.equal(grant.id, "blood-rush.grant-assault-2");
  assert.equal(grant.op, "continuous.grant-keyword");
  // 807.1.b.2: the printed value is 2 (the reminder text "+2 :rb_might: while
  // it's an attacker" is 807.1.c's functional text, not a second ability).
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(grant.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grant.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "blood-rush.unit" }
  });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "permanent" });
  assert.equal(grant.linkedTo, undefined);

  // "a unit": one Board unit, no controller restriction printed (355.9.a.1).
  assert.equal(grant.targets.length, 1);
  assert.deepEqual(grant.targets[0], {
    id: "blood-rush.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-003-221 Blood Rush: the granted Assault 2 expands with the printed value and its designation gate", () => {
  // The expansion is a static continuous.might ability conditioned on the
  // host's attacker designation (807.1.c / 807.1.d.1); the granted value is the
  // card's printed 2, not the 807.1.b.3 presumed 1.
  const [expansion] = assault.expand({
    value: grant.args.value.value,
    host: { canonicalCardId: CANONICAL }
  });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 2 });
  assert.deepEqual(expansion.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "attacker" }
  });
});

test("sfd-003-221 Blood Rush: the merged Repeat keyword preserves the printed one-Energy additional cost", () => {
  const [repeatCost] = repeat.expand({
    host: { canonicalCardId: CANONICAL },
    cost: { energy: 1 }
  });
  assert.equal(repeatCost.kind, "static");
  assert.equal(repeatCost.effect.kind, "repeat.cost");
  assert.equal(repeatCost.effect.count, 1);
  assert.deepEqual(repeatCost.effect.cost, { energy: 1 });
});

test("sfd-003-221 Blood Rush: the original body grants Assault 2 to the chosen unit for its Board existence", () => {
  const kernel = world()
    .object("spell", { zone: "chain", types: ["spell"], cardId: CANONICAL })
    .unit("chosen", { owner: "B", controller: "B", might: 3 })
    .build();
  const chosen = kernel.ref("chosen");
  kernel.setTargets("blood-rush.unit", [chosen]);
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].id, grant.id);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [entry] = kernel.continuousEffects;
  assert.equal(entry.effect.layer, "ability");
  assert.equal(entry.effect.filter.objectId, "chosen");
  assert.equal(entry.effect.filter.zoneEntryId, chosen.zoneEntryId);
  assert.deepEqual(entry.duration, { type: "permanent" });
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.deepEqual(layers.snapshot(chosen).keywords, [{ id: "Assault", value: 2 }]);
  assert.deepEqual(layers.snapshot(kernel.ref("spell")).keywords, []);
  // 801.3.a.3 gives an unspecified-duration grant the target's zone lifetime.
  assert.deepEqual(layers.expireAt("turn-end"), []);
  assert.deepEqual(layers.snapshot(chosen).keywords, [{ id: "Assault", value: 2 }]);
  assert.equal(kernel.perform({ type: "return-to-hand", object: chosen }).status, "done");
  layers.setObjects(kernel.objects);
  assert.equal(kernel.object(chosen), null);
  assert.deepEqual(layers.snapshot(kernel.ref("chosen")).keywords, []);
});

test("sfd-003-221 Blood Rush: the production binder evaluates Assault's condition outside combat", () => {
  const { engine, kernel } = fixture();
  const source = kernel.getObject("source");
  assert.equal(source.combatRole, null);
  const [expansion] = assault.expand({ value: 2, host: { canonicalCardId: CANONICAL } });
  const handle = createEngineStaticBinder(engine).bindStatic(expansion, source);
  const [entry] = engine.layers.registry.list();
  assert.equal(typeof entry.effect.effect.condition, "function");
  assert.equal(entry.effect.effect.amount, 2);
  // The real binder evaluates the IR condition; the layers fallback for an
  // unwrapped condition object is not used. CR 807.1.d.1 gives no Might here.
  assert.equal(engine.layers.snapshot(source.ref).might, source.might);
  handle.unbind();
  assert.equal(engine.layers.registry.list().length, 0);
});

test.todo(
  "sfd-003-221 Blood Rush: runtime granted keywords still need a KeywordDef consumer that " +
    "expands the registered Assault 2 into its printed conditional Might effect (807.1.c)."
);

test("sfd-003-221 Blood Rush: a runtime granted Assault 2 registers the keyword but changes no Might", () => {
  // Re-probed 2026-10-18 (807.1.c / 807.1.d.1): continuous.grant-keyword really
  // lands the keyword on the ability layer. What is missing is the consumer that
  // turns the granted keyword back into its KeywordDef expansion, so an
  // attacker's Might stays at its printed value even though the keyword is
  // present. The layers fallback is measured, not assumed.
  const kernel = world()
    .object("spell", { zone: "chain", types: ["spell"], cardId: CANONICAL })
    .unit("attacker", { might: 3, combatRole: "attacker" })
    .build();
  kernel.setTargets("blood-rush.unit", [kernel.ref("attacker")]);
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");

  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  const snapshot = layers.snapshot(kernel.ref("attacker"));
  // The keyword really is granted (and its printed value is the card's 2).
  assert.deepEqual(snapshot.keywords, [{ id: "Assault", value: 2 }]);
  // …but the attacker-conditioned +2 Might of 807.1.c is not produced.
  assert.equal(kernel.getObject("attacker").combatRole, "attacker");
  assert.equal(snapshot.might, 3);
});

test.todo(
  "sfd-003-221 Blood Rush: the Assault expansion's designation condition must consume the " +
    "ObjectSnapshot combatRole feature (807.1.d.1 / contract 3.8) before the granted +2 Might " +
    "can be proven in and out of Combat."
);

test.todo(
  "sfd-003-221 Blood Rush: collecting the optional 1-energy Repeat cost at Finalize, exposing the " +
    "paid count to the effect execution, and re-making choices for the additional execution " +
    "(820.1.c.1 / 820.1.d.1 / 820.2) need the card-to-Finalize optionalAdditional wiring and " +
    "the paid-instance binding."
);

test("sfd-003-221 Blood Rush: the declared Action keyword supplies Showdown timing", () => {
  const { engine, kernel } = fixture({ turnPlayer: "B" });
  const source = kernel.getObject("source");
  const speed = abilitySpeed(program.abilities, source);
  assert.equal(speed, "action");
  engine.openShowdown("A");
  assert.equal(engine.canAct("A", speed, source.ref, source), true);
  assert.equal(engine.canAct("A", "normal", source.ref, source), false);
});
