import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";

const cardId = "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c";
const program = cardProgramsById.get(cardId);

/** The binding layer refuses judge-required programs; the abilities are unchanged. */
function liftedProgram() {
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  return lifted;
}

test("rumble-scrapper program is registered and validates", () => {
  assert.ok(program, "rumble-scrapper must be in the generated card registry");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("rumble-scrapper identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, cardId);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "Your Mechs have +1 :rb_might: (including me).\n" +
      "When I hold, play a 3 :rb_might: Mech unit token to your base."
  );
});

test("rumble-scrapper: judgeReason states the live Hold-payload gap and the merged parts", () => {
  // The reason must stay a live re-verification: the merged aura/token paths are
  // recorded as executable, and the remaining gap is the Hold payload identity.
  assert.match(program.judgeReason, /scheduleScore/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.match(program.judgeReason, /383\.4\.d\.2\.a/);
  assert.match(program.judgeReason, /473\.2\.b/);
  assert.match(program.judgeReason, /matchesTriggerObject/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.ok(!/RIFT-95|RIFT-257|RIFT-258/.test(program.judgeReason), "merged task ids must not remain as gaps");
});

test("rumble-scrapper structure: static might aura + hold trigger token body", () => {
  assert.equal(program.status, "judge-required");
  assert.ok(program.judgeReason.includes("continuous.might"), "judgeReason must cite the Might layer path");
  assert.ok(program.judgeReason.includes("默认 static 注册"), "judgeReason must record the available default static registration");
  assert.ok(program.judgeReason.includes("来源控制者"), "judgeReason must record the available source-relative controller binding");
  assert.ok(program.judgeReason.includes("pipeline-match"), "judgeReason must cite the hold-event identity gap");
  assert.equal(program.abilities.length, 2);

  const [aura, hold] = program.abilities;
  assert.equal(aura.kind, "static");
  assert.equal(aura.effect.kind, "continuous.might");
  // The production static binder normalizes the authored filter below.
  assert.equal(aura.effect.filter.tag, "Mech");
  assert.equal(aura.effect.filter.controller, "controller");
  assert.equal(aura.effect.value.value, 1);

  assert.equal(hold.kind, "triggered");
  assert.equal(hold.trigger.at, "hold");
  // The closed event vocabulary (EVENT_PATTERN_TYPES) names this discriminant
  // "held"; the pipeline maps it onto the hold timing point.
  assert.equal(hold.trigger.filter.event, "held");
  assert.equal(hold.trigger.filter.filter.source, "self");
  assert.equal(hold.optional, false);
  assert.equal(hold.body.length, 2);
  const [base, instruction] = hold.body;
  assert.equal(base.id, "rumble-scrapper.base");
  assert.equal(base.op, "condition.value");
  assert.deepEqual(base.args.value, { kind: "location", value: "ability-controller-base" });
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.args.token.value, "mech");
  assert.equal(instruction.args.amount.value, 1);
  // 440.2.c / 185.2.a: a *played* token is created on the Chain and the play
  // action takes it over. The preceding expression binds "your base" to the
  // ability controller before the primitive receives its concrete LocationRef.
  assert.equal(instruction.args.mode.value, "play");
  assert.deepEqual(instruction.args.location, { kind: "linked-value", instructionId: "rumble-scrapper.base", key: "value" });
});

test("rumble-scrapper: the authored Hold filter registers but can never match a real hold emission (383.4.d.2.a)", () => {
  // Live evidence for judgeReason: the production registration accepts the
  // closed "held" spelling, but the real emission from turn/flow.ts carries only
  // player + details.battlefieldId, so the translated object anchor (this card)
  // is undefined on the event and the matcher returns false.
  const binding = createProgramBinding({ cardPrograms: [liftedProgram()] });
  const f = fixture({
    cards: [{ id: "scrapper", cardId, types: ["unit"], energy: 4, power: [], might: 4, tags: ["Mech"] }]
  });
  const source = f.kernel.getObject("scrapper");
  const ids = binding.registerProgramTriggers(f.engine, source);
  assert.equal(ids.length, 1);
  const [registration] = [...f.engine.pipeline.checkpoint().triggers.values()];
  assert.equal(registration.spec.at, "hold");
  assert.deepEqual(registration.spec.filter, { event: "held", object: { objectId: "scrapper" } });

  const emitted = { timingPoint: "hold", kind: "hold", player: "A", details: { battlefieldId: "bf1" } };
  assert.equal(matchesTriggerEvent(registration.spec.filter, emitted, "A"), false);
  // A Hold by the opposing player cannot match either: the filter's only
  // identity anchor is this card, which the emission never carries.
  assert.equal(matchesTriggerEvent(registration.spec.filter, { ...emitted, player: "B" }, "A"), false);
});

test("rumble-scrapper golden: the merged continuous.might primitive registers the +1 aura layer entry", () => {
  // Isolated primitive evidence: this deliberately broad filter selects both
  // players. The source-relative card aura is tested through the binder below.
  const kernel = world()
    .unit("scrapper", { owner: "A", controller: "A", tags: ["Mech"], might: 4 })
    .unit("enemy-mech", { owner: "B", controller: "B", tags: ["Mech"], might: 4 })
    .build();
  const [aura] = program.abilities;
  const run = runInstruction(
    might,
    { filter: { tags: ["Mech"], zone: "board" }, amount: aura.effect.value.value },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 2);
  for (const entry of kernel.continuousEffects) {
    assert.equal(entry.effect.layer, "arithmetic");
    assert.equal(entry.effect.effect.kind, "continuous.might");
    assert.equal(entry.effect.effect.amount, 1);
    assert.deepEqual(entry.duration, { type: "permanent" });
  }

  // Both objects were explicitly selected above; this does not model the
  // printed friendly-only aura.
  const engine = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  );
  assert.equal(engine.evaluate(kernel.ref("scrapper")).might, 5);
  assert.equal(engine.evaluate(kernel.ref("enemy-mech")).might, 5);
});


test("rumble-scrapper golden: production static binding applies the original aura only to friendly Mechs", () => {
  const { engine, kernel } = fixture({ cards: [
    { id: "scrapper", cardId, tags: ["Mech"], might: 4 },
    { id: "ally-mech", tags: ["Mech"], might: 2 },
    { id: "ally-other", tags: [], might: 2 },
    { id: "enemy-mech", owner: "B", controller: "B", tags: ["Mech"], might: 4 },
    { id: "later-mech", tags: ["Mech"], might: 3 }
  ] });
  for (const id of ["scrapper", "ally-mech", "ally-other", "enemy-mech"]) {
    engine.commit({ type: "move-zone", object: kernel.ref(id), to: "base", location: { type: "base", player: kernel.getObject(id).controller } });
  }
  const handle = createEngineStaticBinder(engine).bindStatic(program.abilities[0], kernel.getObject("scrapper"));
  const [entry] = engine.layers.registry.list();
  assert.equal(engine.layers.registry.list().length, 1);
  assert.deepEqual(entry.effect.filter, { tags: ["Mech"], controller: "A", zone: "board" });
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("scrapper")).might, 5);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-mech")).might, 3);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-other")).might, 2);
  assert.equal(engine.layers.evaluate(kernel.ref("enemy-mech")).might, 4);
  assert.equal(engine.layers.evaluate(kernel.ref("later-mech")).might, 3);

  engine.commit({ type: "move-zone", object: kernel.ref("later-mech"), to: "base", location: { type: "base", player: "A" } });
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("later-mech")).might, 4);
  handle.unbind();
  assert.equal(engine.layers.registry.list().length, 0);
  assert.equal(engine.layers.evaluate(kernel.ref("scrapper")).might, 4);
  assert.equal(engine.layers.evaluate(kernel.ref("ally-mech")).might, 2);
});

test("rumble-scrapper golden: the original Hold body creates and plays the printed Mech token to your base", () => {
  const kernel = world().player("A").player("B").build();
  const outcome = resolveChainBody(program.abilities[1].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [["rumble-scrapper.base", "executed"], ["play-mech-token", "executed"]]);
  assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
  const tokens = kernel.objects.filter(object => object.isToken);
  assert.equal(tokens.length, 1);
  const [token] = tokens;
  assert.equal(token.name, "Mech");
  assert.deepEqual(token.types, ["unit"]);
  assert.deepEqual(token.tags, ["Mech"]);
  assert.equal(token.might, 3);
  assert.equal(token.energy, null);
  assert.equal(token.power, null);
  assert.equal(token.controller, "A");
  assert.equal(token.zone, "board");
  assert.deepEqual(token.location, { type: "base", player: "A" });
  assert.deepEqual(kernel.pendingItems, []);
  assert.deepEqual(outcome.results[1].result.linkedValues["token.objects"], [token.ref]);
});

test.todo(
  "rumble-scrapper: the hold emission must carry the held Battlefield/Unit identity so 383.4.d.2.a " +
    "(this Unit's own presence at the battlefield it Held) can be decided; until then other-field and " +
    "enemy Hold waves cannot be excluded even though the anchor spelling now registers"
);


test("rumble-scrapper golden: the same original body plays a token to player B's base", () => {
  const initial = world().player("A").player("B").unit("scrapper", { owner: "B", controller: "B", cardId }).build();
  const kernel = initial.clone({ controller: "B", sourceSnapshot: initial.getObject("scrapper") });
  const outcome = resolveChainBody(program.abilities[1].body, kernel);
  assert.equal(outcome.status, "executed");
  const [token] = kernel.objects.filter(object => object.isToken);
  assert.equal(token.controller, "B");
  assert.deepEqual(token.location, { type: "base", player: "B" });
  assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
  assert.equal(token.energy, null);
  assert.equal(token.power, null);
});
