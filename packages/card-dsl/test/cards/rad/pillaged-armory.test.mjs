import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/pillaged-armory.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const buff = (await import(new URL("effects/instructions/effect.buff.js", ENGINE))).default;
const deploy = (await import(new URL("effects/keywords/Deploy.js", ENGINE))).default;
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
const { ProgramRegistry } = await import(new URL("programs/registry.js", ENGINE));
const { triggerRegistrations } = await import(new URL("programs/triggers.js", ENGINE));
const { matchesTriggerEvent } = await import(new URL("events/pipeline-match.js", ENGINE));
const { createEngineStaticBinder } = await import(new URL("programs/statics.js", ENGINE));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", ENGINE));
const { ChainEngine } = await import(new URL("chain/engine.js", ENGINE));
const { playLocations } = await import(new URL("layers/rules/query.js", ENGINE));

const CARD_ID = "card.hash-c3300d4c2699318874a04e6169dc566f6c3e88300d3f2ccd920a1edf3352d84a";
const EXPECTED_SOURCE =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "When you play this or when you conquer here, [Buff] a friendly unit. " +
  "(Give it a +1 :rb_might: buff if it doesn't have one.)";

test("rad-073-167 Pillaged Armory: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /TriggerRegistration/);
  assert.match(program.judgeReason, /RIFT-267/);
  assert.match(program.judgeReason, /layerFor|continuous\.location/);
  assert.match(program.judgeReason, /Unsupported filter field here/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120/);
});

test("rad-073-167 Pillaged Armory: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-073-167 Pillaged Armory: Deploy keyword plus two independent Buff triggers", () => {
  assert.equal(program.abilities.length, 3);
  const [deploy, onPlay, onConquer] = program.abilities;
  assert.deepEqual(deploy, { kind: "keyword", keyword: "deploy" });

  // 383.4.a.1：Gear 的 Play Effect。
  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "self" }
  });
  assert.equal(onPlay.optional, false);
  assert.deepEqual(onPlay.body.map((step) => [step.id, step.op]), [
    ["pillaged-armory.buff-on-play", "effect.buff"]
  ]);

  // 383.4.c.1："when you conquer here"。
  assert.equal(onConquer.kind, "triggered");
  assert.equal(onConquer.trigger.at, "conquer");
  assert.deepEqual(onConquer.trigger.filter, { event: "conquer", here: true, player: "self" });
  assert.equal(onConquer.optional, false);
  assert.deepEqual(onConquer.body.map((step) => [step.id, step.op]), [
    ["pillaged-armory.buff-on-conquer", "effect.buff"]
  ]);
});

test("rad-073-167 Pillaged Armory: each Buff instruction targets exactly one friendly board unit", () => {
  const [, onPlay, onConquer] = program.abilities;
  for (const [specId, ability] of [
    ["friendly-unit-on-play", onPlay],
    ["friendly-unit-on-conquer", onConquer]
  ]) {
    const [instruction] = ability.body;
    assert.deepEqual(instruction.args.mode, { kind: "constant", value: "buff" });
    assert.deepEqual(instruction.args.target, { kind: "constant", value: specId });
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.picks, undefined);
    assert.deepEqual(instruction.targets, [{
      id: specId,
      filter: { type: "unit", controller: "self", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }]);
  }
});

test("rad-073-167 Pillaged Armory: the Buff body really places a Buff counter (CR 427.1.b)", () => {
  const [instruction] = program.abilities[1].body;
  const kernel = world()
    .unit("pillaged-armory", { types: ["gear"], might: null, energy: 1, power: null })
    .unit("friendly-unit", { might: 2, buffs: 0 })
    .build();
  const run = runInstruction(
    buff,
    { mode: instruction.args.mode.value, target: instruction.args.target.value },
    { world: kernel, targets: { "friendly-unit-on-play": [kernel.ref("friendly-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly-unit").buffs, 1);
  assert.equal(run.linked.buffedCount, 1);
  assert.deepEqual(run.events.map((event) => event.action), ["buff"]);
});

test("rad-073-167 Pillaged Armory: a unit that already has a Buff is not buffed again (CR 702.3.a)", () => {
  const [instruction] = program.abilities[2].body;
  const kernel = world()
    .unit("pillaged-armory", { types: ["gear"], might: null, energy: 1, power: null })
    .unit("already-buffed", { might: 2, buffs: 1 })
    .build();
  const run = runInstruction(
    buff,
    { mode: instruction.args.mode.value, target: instruction.args.target.value },
    { world: kernel, targets: { "friendly-unit-on-conquer": [kernel.ref("already-buffed")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.getObject("already-buffed").buffs, 1);
  assert.deepEqual(run.events, []);
});

test("rad-073-167 Pillaged Armory: the merged Deploy expansion and its kill body", () => {
  // RIFT-267's KeywordDef is merged (contract 3.7): it expands to the
  // continuous.location declaration plus the "opponent holds here" kill
  // trigger. The kill body really executes; the consumers that would wire the
  // declaration and the trigger are the open RIFT-120 gaps in judgeReason.
  assert.equal(deploy.keyword, "Deploy");
  const expansion = deploy.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.deepEqual(expansion.map((ability) => ability.kind), ["static", "triggered"]);
  assert.equal(expansion[0].effect.kind, "continuous.location");
  assert.equal(expansion[1].trigger.at, "hold");

  const kill = expansion[1].body[0];
  assert.equal(kill.op, "effect.kill");
  assert.deepEqual(kill.args.self, { kind: "constant", value: true });
  const base = world().object("pillaged-armory", {
    owner: "A", types: ["gear"], might: null, energy: 1, power: null,
    zone: "board", location: { type: "battlefield", id: "bf-1" }
  }).build();
  // effect.kill self acts on the ability source; bind it explicitly like the
  // merged Deploy keyword golden does.
  const kernel = base.clone({ sourceSnapshot: base.getObject("pillaged-armory") });
  const outcome = runAbilityBody(expansion[1].body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("pillaged-armory").zone, "trash");
});

test.todo("rad-073-167 Pillaged Armory: the Deploy expansion's continuous.location play-location permission, the non-Unit cleanup recall exemption and the opponent-Hold kill trigger still need consumers (CR 830.1.b; layer mapping, Finalize placement, cleanup recall and the hold here-predicate).");
test.todo("rad-073-167 Pillaged Armory: \"when you conquer here\" needs a conquer payload whose battlefield identity can be bound to the source before that trigger can fire for real (CR 383.4.c / 830.3).");

/** Kernel + chain engine exercising the production static binder and trigger adapter. */
function productionEngine(kernel) {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  return new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
}

test("rad-073-167 Pillaged Armory: the Deploy location declaration binds its placement rule", () => {
  // 830.1.b grants the play/create permission; the production binder now
  // installs the continuous.location declaration for the Gear incarnation.
  const expansion = deploy.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(expansion[0].effect.kind, "continuous.location");
  assert.equal(expansion[0].effect.cleanup.recall, "unit-only");
  const kernel = world().object("gear", { cardId: program.canonicalCardId, types: ["gear"], might: null, energy: 1, power: null }).build();
  const engine = productionEngine(kernel);
  const binder = createEngineStaticBinder(engine);
  const handle = binder.bindStatic(expansion[0], kernel.getObject("gear"));
  assert.equal(typeof handle.unbind, "function");
  handle.unbind();
});

test("rad-073-167 Pillaged Armory: 'When you play this' fires for its own controller only", () => {
  // 383.4.a.1: the Play Effect compiles through the merged trigger adapter and
  // matches the source card's own card-played event for the controller (the
  // buff body itself is executed for real in the cases above).
  const [, onPlay] = program.abilities;
  const kernel = world().object("gear", { cardId: program.canonicalCardId, types: ["gear"], might: null, energy: 1, power: null, controller: "A" }).build();
  const registration = triggerRegistrations(
    new ProgramRegistry([{ canonicalCardId: program.canonicalCardId, rulesetVersion: "core-1.5", status: "executable", sourceText: program.sourceText, abilities: [onPlay] }]),
    kernel.getObject("gear")
  )[0];
  assert.equal(registration.spec.at, "card-played");
  assert.deepEqual(registration.spec.filter, { event: "card-played", object: { objectId: "gear" }, player: "self" });
  const ownPlay = { timingPoint: "card-played", kind: "card-played", player: "A", object: kernel.getObject("gear") };
  assert.equal(matchesTriggerEvent(registration.spec.filter, ownPlay, "A"), true);
  assert.equal(matchesTriggerEvent(registration.spec.filter, { ...ownPlay, player: "B" }, "A"), false);
});

test("rad-073-167 Pillaged Armory: 'when you conquer here' registers with the here anchor", () => {
  // 383.4.c.1 / 830.3: the production translator now preserves the Battlefield
  // scope on the conquer registration.
  const [, , onConquer] = program.abilities;
  const kernel = world().object("gear", { cardId: program.canonicalCardId, types: ["gear"], might: null, energy: 1, power: null, controller: "A" }).build();
  const [registration] = triggerRegistrations(
    new ProgramRegistry([{ canonicalCardId: program.canonicalCardId, rulesetVersion: "core-1.5", status: "executable", sourceText: program.sourceText, abilities: [onConquer] }]),
    kernel.getObject("gear")
  );
  assert.equal(registration.spec.at, "conquer");
  assert.equal(registration.spec.filter.here, true);
});
