import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/lucian-merciless.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { ProgramRegistry } = await import(new URL("programs/registry.js", engineCore));
const { triggerRegistrations } = await import(new URL("programs/triggers.js", engineCore));
const { matchesTriggerEvent } = await import(new URL("events/pipeline-match.js", engineCore));
const { createProgramBinding } = await import(new URL("programs/index.js", engineCore));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", engineCore));
const { TurnFlow } = await import(new URL("turn/flow.js", engineCore));
const { productionPlay } = await import("../../fixtures/production-play.mjs");

const lucianWorld = ({ exhausted } = {}) => {
  const base = world().unit("lucian", { exhausted, might: 3 }).build();
  return base.clone({ sourceSnapshot: base.getObject("lucian") });
};

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /[Ww]eaponmaster/);
  assert.match(program.judgeReason, /821\.1\.c\.2/);
  assert.match(program.judgeReason, /\[A\]\/\[C\]/);
  assert.match(program.judgeReason, /Conquer 不再是缺口/);
  assert.doesNotMatch(program.judgeReason, /without participating Unit objects/);
  assert.ok(program.sourceText.includes("[Weaponmaster]"));
  assert.ok(program.sourceText.includes("The first time I conquer each turn, ready me."));
});

test("abilities: Weaponmaster keyword plus a per-turn conquer trigger that readies self", () => {
  assert.equal(program.abilities.length, 2);

  const keyword = program.abilities[0];
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "weaponmaster");
  assert.equal(keyword.value, undefined);

  const triggered = program.abilities[1];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "conquer");
  assert.deepEqual(triggered.trigger.filter, { event: "conquered", role: "self" });
  assert.equal(triggered.trigger.once, "per-turn");
  assert.equal(triggered.optional, false);

  assert.equal(triggered.body.length, 1);
  const instruction = triggered.body[0];
  assert.equal(instruction.id, "ready-self");
  assert.equal(instruction.op, "effect.ready");
  assert.deepEqual(instruction.args, {});
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("conquer trigger body executes through the interpreter and reference kernel: 'ready me'", () => {
  // effect.ready with no args defaults to { kind: "source" } ("ready me").
  const kernel = lucianWorld({ exhausted: true });
  const ability = program.abilities[1];
  const outcome = runAbilityBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("lucian").exhausted, false);
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].op, "effect.ready");
  assert.equal(outcome.results[0].result.status, "executed");
});

test("conquer trigger body on an already-ready source is a no-op (CR 416.1.c)", () => {
  const kernel = lucianWorld({ exhausted: false });
  const ability = program.abilities[1];
  const outcome = runAbilityBody(ability.body, kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("lucian").exhausted, false);
});

test("conquer trigger binds the real per-Unit conquer payload", () => {
  const { judgeReason, ...binding } = program;
  const registry = new ProgramRegistry([{ ...binding, status: "executable" }]);
  const base = world().unit("lucian", { cardId: program.canonicalCardId }).build();
  const registrations = triggerRegistrations(registry, base.getObject("lucian"));
  const conquer = registrations.find((entry) => entry.spec.at === "conquer");
  assert.ok(conquer, "the merged adapter must register the conquer trigger");
  assert.deepEqual(conquer.spec.filter.object, { objectId: "lucian" });
  assert.equal(conquer.spec.once, "per-turn");
  assert.deepEqual(conquer.activeZones, ["board"]);

  assert.equal(
    matchesTriggerEvent(conquer.spec.filter, {
      kind: "conquer", timingPoint: "conquer", object: base.getObject("lucian"),
      source: base.getObject("lucian"), it: base.getObject("lucian"), player: "A",
      details: { battlefieldId: "bf1", objectId: "lucian", playerId: "A" }
    }, "A"),
    true
  );
});

function conquerFixture({ includeLucian = true, extraParticipant = false, lucianAtBase = false } = {}) {
  const builder = world()
    .player("A")
    .player("B")
    .deck(Array.from({ length: 8 }, (_, index) => `A:deck:${index}`), { owner: "A" })
    .deck(Array.from({ length: 8 }, (_, index) => `B:deck:${index}`), { owner: "B" })
    .rune(Array.from({ length: 8 }, (_, index) => `A:rune:${index}`), { owner: "A" })
    .rune(Array.from({ length: 8 }, (_, index) => `B:rune:${index}`), { owner: "B" })
    .base("source", { owner: "A", controller: "A", might: 1 });
  if (includeLucian) {
    builder.unit("lucian", {
      owner: "A",
      controller: "A",
      cardId: program.canonicalCardId,
      tags: ["Lucian", "Demacia", "Sentinel", "Champion"],
      might: 3,
      exhausted: true,
      location: lucianAtBase ? { type: "base", player: "A" } : { type: "battlefield", id: "bf1" }
    });
  }
  if (extraParticipant) {
    builder.unit("ally", {
      owner: "A",
      controller: "A",
      cardId: null,
      might: 1,
      location: { type: "battlefield", id: "bf1" }
    });
  }
  const kernel = builder.build();
  const choose = (request) => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const flow = new TurnFlow({
    host,
    player: (id) => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }],
    victoryScore: 20
  });
  const admitted = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [admitted] });
  const registrations = includeLucian
    ? binding.registerProgramTriggers(flow.chain, kernel.getObject("lucian"))
    : [];
  const fired = [];
  const append = flow.chain.pipeline.onTrigger;
  flow.chain.pipeline.onTrigger = (snapshot) => {
    fired.push(snapshot);
    append(snapshot);
  };
  const settle = (budget = 100) => {
    for (let index = 0; index < budget; index++) {
      if (flow.chain.items.length) { flow.chain.pass(flow.chain.priority); continue; }
      if (flow.chain.focus) { flow.pass(flow.chain.focus); continue; }
      return;
    }
    throw new Error("TurnFlow did not settle");
  };
  flow.start();
  settle();
  return { flow, kernel, binding, registrations, fired, settle };
}

test("production golden: a real Conquer by Lucian readies him once and keeps resources unchanged", () => {
  const f = conquerFixture();
  const conquer = f.flow.chain.pipeline.events.filter((event) => event.timingPoint === "conquer");
  assert.equal(conquer.length, 1);
  assert.deepEqual(conquer[0].object.ref, f.kernel.ref("lucian"));
  assert.deepEqual(conquer[0].source.ref, f.kernel.ref("lucian"));
  assert.deepEqual(conquer[0].it.ref, f.kernel.ref("lucian"));
  assert.deepEqual(conquer[0].details, {
    battlefieldId: "bf1",
    battlefieldControllerBefore: null,
    objectId: "lucian",
    playerId: "A"
  });
  assert.equal(f.fired.filter((entry) => entry.registration.spec.at === "conquer").length, 1);
  assert.equal(f.kernel.getObject("lucian").exhausted, false);
  assert.equal(f.kernel.getObject("lucian").location.id, "bf1");
  assert.equal(f.flow.battlefields[0].controller, "A");
  assert.equal(f.kernel.player("A").score, 1);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.flow.chain.items, []);
});

test("production boundary: each participating Unit has its own event, while a nonparticipant has none", () => {
  const withAlly = conquerFixture({ extraParticipant: true });
  const events = withAlly.flow.chain.pipeline.events.filter((event) => event.timingPoint === "conquer");
  assert.deepEqual(new Set(events.map((event) => event.object.ref.id)), new Set(["lucian", "ally"]));
  assert.equal(withAlly.fired.filter((entry) => entry.registration.spec.at === "conquer").length, 1);
  assert.equal(withAlly.kernel.getObject("lucian").exhausted, false);

  const nonparticipant = conquerFixture({ extraParticipant: true, lucianAtBase: true });
  const nonparticipantEvents = nonparticipant.flow.chain.pipeline.events.filter((event) => event.timingPoint === "conquer");
  assert.deepEqual(nonparticipantEvents.map((event) => event.object.ref.id), ["ally"]);
  assert.equal(nonparticipant.fired.filter((entry) => entry.registration.spec.at === "conquer").length, 0);
});

test("production gap: selecting an Equipment reaches the authoritative Equip-cost guard atomically", () => {
  const admitted = { ...program, status: "executable", judgeReason: undefined };
  const longSwordId = "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010";
  const f = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3 }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", {
        owner: "A", controller: "A", cardId: longSwordId, types: ["gear"],
        tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" },
        energy: 2, power: ["Fury"], might: 2
      })
  });
  assert.throws(
    () => f.play("lucian"),
    (error) => error.name === "CostFailure" && /821\.1\.c\.2/.test(error.message) &&
      /missing authoritative Equip-cost binding/.test(error.message)
  );
  assert.equal(f.requests[0].id, "target:weaponmaster-equipment");
  assert.deepEqual(f.requests[0].options.map((ref) => ref.id), ["sword"]);
  assert.equal(f.kernel.getObject("sword").attachedTo, null, "the failed cost never reaches attachment");
  assert.equal(f.kernel.player("A").energy, 0, "the printed Unit play cost was paid before the trigger");
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.engine.items.map((item) => [item.id, item.status]), [["trigger:1", "finalized"]]);
});
