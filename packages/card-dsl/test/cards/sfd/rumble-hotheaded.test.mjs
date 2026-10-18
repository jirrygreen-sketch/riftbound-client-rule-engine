// Golden test for Rumble, Hotheaded (sfd-026-221).
// Test supported static and primitive subeffects independently. Conquer
// identity, recycle-cost selection and nested play cost binding remain blocked.
import test from "node:test";
import assert from "node:assert/strict";
import { validateCardProgram } from "../../../../../packages/card-dsl/dist/ir/index.js";
import program from "../../../../../packages/card-dsl/dist/cards/sfd/rumble-hotheaded.js";
import { cardRegistryById } from "../../../../../packages/card-dsl/dist/cards/registry.generated.js";
import recycleDef from "../../../../../packages/engine-core/dist/effects/instructions/effect.recycle.js";
import playDef from "../../../../../packages/engine-core/dist/effects/instructions/effect.play.js";
import keyword from "../../../../../packages/engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { translateObjectFilter, translateInstructionTargets } from "../../../../../packages/engine-core/dist/programs/filters.js";
import { translateCost } from "../../../../../packages/engine-core/dist/programs/play.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { world, runInstruction } from "../../../../../packages/engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870";

test("program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason ?? "", /continuous\.grant-keyword/);
  assert.match(program.judgeReason ?? "", /默认 static binder/);
  assert.match(program.judgeReason ?? "", /运行时授予的关键词没有展开/);
  assert.match(program.judgeReason ?? "", /cost\.modify\/cost\.pay/);
  assert.match(program.judgeReason ?? "", /运行时授予/);
  assert.match(program.judgeReason ?? "", /designation/);
  assert.match(program.judgeReason ?? "", /conquered/);
  assert.match(program.sourceText, /Your Mechs each have \[Assault\]/);
});

test("program is the registered identity for its canonical card id", () => {
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("static ability grants Assault to friendly Mech units", () => {
  const [grant] = program.abilities;
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "Assault");
  assert.deepEqual(grant.effect.value, { kind: "constant", value: 1 });
  assert.deepEqual(grant.effect.filter, {
    zone: "board",
    controller: "controller",
    tag: "Mech",
    type: "unit"
  });
});

test("conquer trigger is optional, self-scoped, and links recycle into play", () => {
  const [, trigger] = program.abilities;
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.optional, true);
  assert.equal(trigger.trigger.at, "conquer");
  // The closed EventPattern discriminant for the conquer timing point is
  // "conquered" (events/pipeline-match.ts maps it onto conquer), and the
  // anchor is this card (383.4.c.2.a).
  assert.deepEqual(trigger.trigger.filter, { event: "conquered", filter: { source: "self" } });
  assert.equal(trigger.body.length, 2);

  const [recycle, play] = trigger.body;
  assert.equal(recycle.op, "effect.recycle");
  assert.equal(recycle.targets?.length, 1);
  assert.deepEqual(recycle.targets?.[0], {
    id: "rumble.fodder",
    filter: { zone: "board", controller: "controller", type: "unit", role: "other-friendly" },
    min: 1,
    max: 1,
    selection: "one"
  });

  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, "rumble.recycle-fodder");
  assert.deepEqual(play.args.target, { kind: "constant", value: "rumble.mech-in-trash" });
  assert.deepEqual(play.args.cost, {
    kind: "constant",
    value: {
      finalized: true,
      energy: {
        kind: "linked-value",
        instructionId: "rumble.recycle-fodder",
        key: "recycledMight"
      }
    }
  });
  assert.deepEqual(play.targets?.[0], {
    id: "rumble.mech-in-trash",
    filter: { zone: "trash", owner: "controller", tag: "Mech", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("reference kernel: recycling the fodder unit moves it to the bottom of its deck", () => {
  const testWorld = world().base("fodder", { owner: "A", might: 3 }).build();
  const run = runInstruction(
    recycleDef,
    { target: "rumble.fodder" },
    { world: testWorld, targets: { "rumble.fodder": [testWorld.ref("fodder")] } }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked["recycledCount"], 1);
  assert.equal(testWorld.getObject("fodder")?.zone, "deck");
  assert.deepEqual(testWorld.objectsInZone("A", "deck"), [{ id: "fodder", zoneEntryId: 2 }]);
});

test("reference kernel: an isolated play with an explicit cost moves the chosen Mech from trash to the board", () => {
  const testWorld = world()
    .player("A", { energy: 5 })
    .card("mech-card", { owner: "A", zone: "trash", types: ["unit"], tags: ["Mech"], energy: 5 })
    .build();
  const run = runInstruction(
    playDef,
    {
      target: "rumble.mech-in-trash",
      cost: { kind: "constant", value: { finalized: true, energy: 5 } }
    },
    {
      world: testWorld,
      targets: { "rumble.mech-in-trash": [testWorld.ref("mech-card")] }
    }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked["played"], 1);
  assert.equal(testWorld.getObject("mech-card")?.zone, "board");
  assert.equal(testWorld.player("A").energy, 0);
});

test.todo(
  "Rumble, Hotheaded: the cost plan must derive the discount from the recycled unit's Might " +
    "(the merged effect.recycle links references, not a Might value) and apply it at Finalize — " +
    "recycled Might snapshot / nested play Finalize adapter"
);
test("the merged continuous.grant-keyword primitive registers the Assault grant itself", () => {
  // The merged continuous.grant-keyword static data is
  // executable once a consumer registers it: the primitive writes an
  // ability-layer keyword grant per matching object with the printed value.
  // The production default binder normalizes the card's filter in the next test.
  const kernel = world()
    .unit("mech", { owner: "A", controller: "A", tags: ["Mech"] })
    .build();
  const [grant] = program.abilities;
  const run = runInstruction(
    keyword,
    {
      keyword: grant.effect.keyword,
      value: grant.effect.value.value,
      filter: { tags: ["Mech"], zone: "board" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registered] = kernel.continuousEffects;
  assert.equal(registered.effect.layer, "ability");
  assert.equal(registered.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registered.effect.effect.keyword, "Assault");
  // The primitive snapshots the printed value for the ability layer rather
  // than re-reading the card data (807.1.b.3: an omitted value presumes 1).
  assert.equal(registered.effect.effect.keywordValue, 1);
  assert.deepEqual(registered.effect.filter.objectId, "mech");

  // The card's own card-program filter is only translatable through the
  // programs layer, where `tag` becomes `tags` and `controller` becomes `self`.
  assert.deepEqual(translateObjectFilter(grant.effect.filter), {
    zone: "board",
    controller: "self",
    tags: ["Mech"],
    type: "unit"
  });
});

test("the card retains its blocked discount declaration and recycle reference links", () => {
  // Evidence for the judgeReason: the discount cannot be declared through the
  // card's `cost` field yet. The merged adapter accepts only
  // printed/activated/explicit cost kinds; a FinalizedCostPlan literal is
  // outside that vocabulary, so the discount has to come from the cost plan.
  const [, trigger] = program.abilities;
  const [, play] = trigger.body;
  assert.deepEqual(play.args.cost, {
    kind: "constant",
    value: {
      finalized: true,
      energy: { kind: "linked-value", instructionId: "rumble.recycle-fodder", key: "recycledMight" }
    }
  });
  const translated = translateCost({ kind: "printed", energy: { kind: "constant", value: 5 } }, "rumble.play-mech", "play");
  assert.deepEqual(translated, { kind: "explicit", energy: { kind: "constant", value: 5 } });

  // The merged effect.recycle links the recycled references and their count;
  // the Might value the program reads must be derived from those references by
  // card-specific snapshot and Finalize binding.
  const kernel = world().base("fodder", { owner: "A", might: 3 }).build();
  const recycled = runInstruction(
    recycleDef,
    { target: "rumble.fodder" },
    { world: kernel, targets: { "rumble.fodder": [kernel.ref("fodder")] } }
  );
  assert.equal(recycled.result.status, "executed");
  assert.equal(recycled.linked.recycledCount, 1);
  assert.deepEqual(recycled.linked.recycled, [{ id: "fodder", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("fodder").zone, "deck");
});


test.todo(
  "consume runtime-granted Assault as attacker-only Might (807.1.c/.d.1), with designation/combatRole alignment"
);

test("Rumble, Hotheaded: the production binder really grants Assault but the grant never becomes Might", () => {
  // 807.1.c/.d.1: the ability-layer grant lands (measured keywords [{ id:
  // "Assault", value: 1 }]) while the arithmetic consumption does not, so the
  // same Mech keeps its printed Might. This is the first recorded gap.
  const { engine, kernel } = fixture({ cards: [
    { id: "rumble", cardId: CANONICAL, tags: ["Mech"], might: 4 },
    { id: "friendly-mech", tags: ["Mech"], might: 3 },
    { id: "enemy-mech", owner: "B", controller: "B", tags: ["Mech"], might: 3 }
  ] });
  for (const id of ["rumble", "friendly-mech", "enemy-mech"]) {
    engine.commit({ type: "move-zone", object: kernel.ref(id), to: "base", location: { type: "base", player: kernel.getObject(id).controller } });
  }
  createEngineStaticBinder(engine).bindStatic(program.abilities[0], kernel.getObject("rumble"));
  engine.layers.setObjects(kernel.objects);
  assert.deepEqual(engine.layers.evaluate(kernel.ref("friendly-mech")).keywords, [{ id: "Assault", value: 1 }]);
  assert.equal(engine.layers.evaluate(kernel.ref("friendly-mech")).might, 3);
  assert.deepEqual(engine.layers.evaluate(kernel.ref("enemy-mech")).keywords, []);
});

test("Rumble, Hotheaded: the rewritten conquer trigger registers but cannot match a real conquer wave", () => {
  // 383.4.c / 383.4.c.2.a: the closed discriminant and the source anchor are now
  // registrable, but the production Score wave emits only
  // { player, details: { battlefieldId } }, so the translated object anchor is
  // undefined on the event and the matcher fails closed.
  const { engine, kernel } = fixture({ cards: [{ id: "rumble", cardId: CANONICAL, tags: ["Mech"], might: 4 }] });
  const [, trigger] = program.abilities;
  // The recycle target keeps its printed relative anchor, which the program
  // binding still rejects (asserted below); this registration view replaces
  // only that clause so the trigger filter itself can be measured.
  const registrationBody = [{ ...trigger.body[0], targets: [{ ...trigger.body[0].targets[0], filter: { zone: "board", controller: "controller", type: "unit" } }] }];
  const lifted = { ...program, status: "executable", judgeReason: undefined, abilities: [program.abilities[0], { ...trigger, body: registrationBody }] };
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const ids = binding.registerProgramTriggers(engine, kernel.getObject("rumble"));
  assert.equal(ids.length, 1);
  const [registration] = [...engine.pipeline.checkpoint().triggers.values()];
  assert.deepEqual(registration.spec, {
    at: "conquer",
    filter: { event: "conquered", object: { objectId: "rumble" } }
  });
  assert.doesNotThrow(() => assertTriggerSpec(registration.spec));
  const emission = { timingPoint: "conquer", kind: "conquer", player: "A", details: { battlefieldId: "bf1" } };
  assert.equal(matchesTriggerEvent(registration.spec.filter, emission, "A"), false);
  // A payload that did carry this unit would match, which isolates the gap to
  // the missing battlefield/object identity in the real emission.
  assert.equal(matchesTriggerEvent(registration.spec.filter, { ...emission, object: kernel.getObject("rumble") }, "A"), true);

  // The printed recycle clause itself still cannot be translated.
  assert.throws(
    () => translateInstructionTargets(trigger.body),
    (error) => error.code === "judge-required" && /Unsupported filter field role/.test(error.message)
  );
});


test("Rumble, Hotheaded: the default static binder registers the original friendly-Mech Assault aura", () => {
  const { engine, kernel } = fixture({ cards: [
    { id: "rumble", cardId: CANONICAL, tags: ["Mech"], might: 4 },
    { id: "friendly-mech", tags: ["Mech"], might: 3 },
    { id: "friendly-other", tags: [], might: 3 },
    { id: "enemy-mech", owner: "B", controller: "B", tags: ["Mech"], might: 3 }
  ] });
  for (const id of ["rumble", "friendly-mech", "friendly-other", "enemy-mech"]) {
    engine.commit({ type: "move-zone", object: kernel.ref(id), to: "base", location: { type: "base", player: kernel.getObject(id).controller } });
  }
  const handle = createEngineStaticBinder(engine).bindStatic(program.abilities[0], kernel.getObject("rumble"));
  const [entry] = engine.layers.registry.list();
  assert.deepEqual(entry.effect.filter, { zone: "board", controller: "A", tags: ["Mech"], type: "unit" });
  engine.layers.setObjects(kernel.objects);
  for (const id of ["rumble", "friendly-mech"]) {
    assert.deepEqual(engine.layers.evaluate(kernel.ref(id)).keywords, [{ id: "Assault", value: 1 }]);
  }
  for (const id of ["friendly-other", "enemy-mech"]) {
    assert.deepEqual(engine.layers.evaluate(kernel.ref(id)).keywords, []);
  }
  handle.unbind();
  assert.equal(engine.layers.registry.list().length, 0);
  assert.deepEqual(engine.layers.evaluate(kernel.ref("friendly-mech")).keywords, []);
});

test("Rumble, Hotheaded: merged cost.modify and cost.pay execute a real Might-valued discount independently", () => {
  // This proves the primitives have landed. The original card still needs to
  // take the recycle-cost snapshot and bind the plan to the selected Mech.
  const kernel = world().player("A", { energy: 5 }).base("fodder", { might: 3 }).build();
  const modified = runInstruction(costModify, {
    id: "mech-cost-probe",
    cost: { kind: "explicit", energy: { kind: "constant", value: 5 } },
    modifier: { kind: "reduce", resource: "energy", amount: { kind: "object-property", object: { target: "fodder" }, property: "might" } }
  }, { world: kernel, targets: { fodder: [kernel.ref("fodder")] } });
  assert.equal(modified.result.status, "executed");
  assert.equal(modified.linked.cost.finalized, true);
  assert.equal(modified.linked.cost.total.energy, 2);
  assert.equal(kernel.player("A").energy, 5);
  const paid = runInstruction(costPay, {
    cost: { kind: "constant", value: modified.linked.cost }
  }, { world: kernel });
  assert.equal(paid.result.status, "executed");
  assert.equal(kernel.player("A").energy, 3);
  assert.deepEqual(paid.events.map(event => event.action), ["pay"]);
});
