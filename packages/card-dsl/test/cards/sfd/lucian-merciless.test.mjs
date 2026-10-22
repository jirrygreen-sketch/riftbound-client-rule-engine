import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/lucian-merciless.js";
import longSword from "../../../dist/cards/sfd/long-sword.js";
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

const admitted = { ...program, status: "executable", judgeReason: undefined };
const LONGSWORD_ID = "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010";

const equipmentKeywords = (ability) => ({
  id: ability.keyword,
  ...(ability.value === undefined ? {} : { value: ability.value }),
  ...(ability.params === undefined ? {} : { params: structuredClone(ability.params) })
});

// Official evidence, checked 2026-10-22:
// - Core Rules v1.5: dated 2026-10-09, effective 2026-10-16.
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Radiance rulings: effective 2026-10-16; no Lucian-specific replacement.
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// - Spiritforged errata: the [Weaponmaster] line remains printed at [A].
//   https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/
// canonicalCardId: card.hash-c403c2d9835df87cc0774a86145ef937226d5e7ebcfe75282053e23df744f5ef
// Timeline: Play -> Chain Finalize locks Equipment -> card-played Pending ->
// Trigger Finalize reads original [A] and pays -> Resolve attaches. Conquer
// uses TurnFlow move -> per-Unit conquer event -> Pending trigger -> Finalize
// -> Resolve effect.ready. CR 821.1.c.2-.5 / 135.2.e.5.a / 163.2.b /
// 383.3.e.1 / 416.1.b-.c are asserted by the production tests below.

const weaponmasterEquipment = (ability) => ({
  owner: "A", controller: "A", cardId: "test:weaponmaster-equipment", name: "Test Equipment",
  types: ["gear"], tags: ["Equipment"], zone: "board",
  location: { type: "base", player: "A" }, energy: null, power: null, might: null,
  keywords: [equipmentKeywords(ability)]
});

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
  assert.match(program.judgeReason, /Weaponmaster/);
  assert.match(program.judgeReason, /Universal Power/);
  assert.match(program.judgeReason, /135\.2\.e\.5\.a \/ 163\.2\.b/);
  assert.match(program.judgeReason, /effects\/contract\.ts:91/);
  assert.match(program.judgeReason, /test-kernel\.ts:572-592/);
  assert.match(program.judgeReason, /host\.ts:760-771/);
  assert.match(program.judgeReason, /821\.1\.c\.1\/\.c\.4/);
  assert.match(program.judgeReason, /cost\.modify\.ts:435-443/);
  assert.doesNotMatch(program.judgeReason, /missing authoritative Equip-cost binding/);
  assert.doesNotMatch(program.judgeReason, /ObjectSnapshot 没有权威/);
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

test("conquer trigger body on an already-ready source is a no-op (CR 416.1.b-.c)", () => {
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
  const registrations = binding.registerProgramTriggers(flow.chain, kernel.getObject("lucian"));
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
  assert.equal(nonparticipant.kernel.getObject("ally").exhausted, false, "only the participating Unit is readied");
});

test("production golden: Weaponmaster pays the chosen equipment's named Equip cost and attaches", () => {
  const f = productionPlay({
    programs: [admitted, longSword],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3, power: ["Fury"] }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", {
        owner: "A", controller: "A", cardId: LONGSWORD_ID, types: ["gear"],
        tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" },
        energy: 2, power: ["Fury"], might: 2,
        keywords: longSword.abilities
          .filter((ability) => ability.kind === "keyword")
          .map(equipmentKeywords)
      })
  });
  const payments = [];
  const perform = f.kernel.perform.bind(f.kernel);
  f.kernel.perform = (action) => {
    if (action.type === "pay") payments.push(structuredClone(action.plan));
    return perform(action);
  };
  f.play("lucian");
  assert.equal(f.requests[0].id, "target:weaponmaster-equipment");
  assert.deepEqual(f.requests[0].options.map((ref) => ref.id), ["sword"]);
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("lucian").ref);
  assert.equal(f.kernel.player("A").energy, 0, "the Unit play cost was paid; Equip has no Energy cost");
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(payments, [
    { finalized: true, energy: 3, power: [] },
    { finalized: true, energy: 0, power: ["Fury"] }
  ]);
  assert.equal(f.engine.pipeline.events.filter((event) => event.timingPoint === "object-attached").length, 1);
  assert.deepEqual(f.engine.items, []);
});

test("production golden: Weaponmaster reduces one original [A], then pays the remainder with any named Power", () => {
  const equip = {
    keyword: "equip", value: 2, costDomain: "rainbow",
    params: { cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 2 }, allowedDomains: ["any"] }]
    } }
  };
  const f = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3, power: ["Body"] }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", weaponmasterEquipment(equip))
  });
  const payments = [];
  const perform = f.kernel.perform.bind(f.kernel);
  f.kernel.perform = (action) => {
    if (action.type === "pay") payments.push(structuredClone(action.plan));
    return perform(action);
  };
  f.play("lucian");
  assert.deepEqual(payments.at(-1), { finalized: true, energy: 0, power: ["Body"] },
    "two [A] minus one leaves one Power payable by Body (CR 821.1.c.3 / 135.2.e.5.a)");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("lucian").ref);
});

test("production golden: one original [A] is reduced to zero with no payment prompt", () => {
  const equip = {
    keyword: "equip", value: 1, costDomain: "rainbow",
    params: { cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["any"] }]
    } }
  };
  const f = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3 }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", weaponmasterEquipment(equip))
  });
  const payments = [];
  const perform = f.kernel.perform.bind(f.kernel);
  f.kernel.perform = (action) => {
    if (action.type === "pay") payments.push(structuredClone(action.plan));
    return perform(action);
  };
  f.play("lucian");
  assert.deepEqual(payments, [
    { finalized: true, energy: 3, power: [] },
    { finalized: true, energy: 0, power: [] }
  ], "the Equip cost is reduced to zero and still follows the real payment path");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.kernel.getObject("sword").attachedTo, f.kernel.getObject("lucian").ref);
});

test("production blocker: an [A] remainder cannot commit a Universal `any` lot through the current pay host", () => {
  const equip = {
    keyword: "equip", value: 2, costDomain: "rainbow",
    params: { cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 2 }, allowedDomains: ["any"] }]
    } }
  };
  const f = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3, power: ["any"] }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", weaponmasterEquipment(equip))
  });
  const payments = [];
  const perform = f.kernel.perform.bind(f.kernel);
  f.kernel.perform = (action) => {
    if (action.type === "pay") payments.push(structuredClone(action.plan));
    return perform(action);
  };
  assert.throws(
    () => f.play("lucian"),
    (error) => error?.reason === "cannot-pay-cost" && /did not consume the prepared Power resources/.test(error.message)
  );
  assert.deepEqual(payments.at(-1), {
    finalized: true, energy: 0, power: [], universalPower: 1,
    powerSources: [{ source: "any", amount: 1 }]
  });
  assert.deepEqual(f.kernel.player("A").power, ["any"], "the failed host commit does not invent a named-Domain debit");
  assert.equal(f.kernel.getObject("sword").attachedTo, null, "payment ownership fails before attachment");
  assert.equal(f.engine.pipeline.events.some((event) => event.timingPoint === "object-attached"), false);
});

test("production boundary: insufficient Equip Power and no selected Equipment fail without side effects", () => {
  const equip = {
    keyword: "equip", value: 1, costDomain: "Fury",
    params: { cost: {
      kind: "activated",
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Fury"] }]
    } }
  };
  const payable = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3 }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", weaponmasterEquipment(equip))
  });
  assert.throws(() => payable.play("lucian"), /insufficient matching Power/);
  assert.equal(payable.kernel.player("A").energy, 0, "the successful Unit play remains paid");
  assert.equal(payable.kernel.getObject("sword").attachedTo, null);
  assert.equal(payable.engine.pipeline.events.some((event) => event.timingPoint === "object-attached"), false);

  const declined = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": [] },
    build: (w) => w.player("A", { energy: 3, power: ["Fury"] }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", weaponmasterEquipment(equip))
  });
  declined.play("lucian");
  assert.equal(declined.kernel.player("A").energy, 0);
  assert.deepEqual(declined.kernel.player("A").power, ["Fury"], "declining Weaponmaster pays no Equip cost");
  assert.equal(declined.kernel.getObject("lucian").zone, "board");
  assert.equal(declined.kernel.getObject("sword").attachedTo, null);
  assert.deepEqual(declined.targetRequests().map((request) => [request.id, request.options]), [
    ["target:weaponmaster-equipment", [declined.kernel.ref("sword")]]
  ]);
  assert.equal(declined.engine.pipeline.events.some((event) => event.timingPoint === "object-attached"), false);
});

test("production boundary: no Equip cost is still judge-required rather than paid as zero", () => {
  const f = productionPlay({
    programs: [admitted],
    answers: { "target:weaponmaster-equipment": ["sword"] },
    build: (w) => w.player("A", { energy: 3, power: ["Fury"] }).player("B")
      .object("lucian", {
        owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["unit"],
        tags: ["Lucian", "Demacia", "Sentinel", "Champion"], zone: "hand",
        energy: 3, power: null, might: 3
      })
      .object("sword", {
        owner: "A", controller: "A", cardId: "test:no-equip-cost", types: ["gear"],
        tags: ["Equipment"], zone: "board", location: { type: "base", player: "A" },
        energy: null, power: null, might: null,
        keywords: [{ id: "Equip", value: 1 }]
      })
  });
  assert.throws(
    () => f.play("lucian"),
    /821\.1\.c\.2: missing authoritative Equip-cost binding for sword/
  );
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, ["Fury"], "missing Equip cost never becomes a free attachment");
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.equal(f.engine.pipeline.events.some((event) => event.timingPoint === "object-attached"), false);
});
