import assert from "node:assert/strict";
import test from "node:test";
import attach from "../../../src/effects/instructions/effect.attach.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });
const target = id => literal({ kind: "target", id });
const pick = id => literal({ kind: "pick", id });
const choose = (id, filter) => literal({ kind: "choose", id, filter });
const source = literal({ kind: "source" });
const battlefield = { type: "battlefield", id: "battlefield-1" };
const equipment = (id, values = {}) => ({
  name: id, types: ["gear"], tags: ["Equipment"], zone: "board", location: battlefield,
  energy: null, power: null, ...values
});
const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });
const setup = () => withSource(world().object("gear", equipment("gear")).unit("host").unit("other").build(), "gear");
const args = { objects: target("equipment"), host: target("unit") };
const targets = kernel => ({ equipment: [kernel.ref("gear")], unit: [kernel.ref("host")] });

test("effect.attach attaches a current non-Unit and links actual references", () => {
  const kernel = setup();
  const run = runInstruction(attach, args, { world: kernel, targets: targets(kernel) });
  assert.equal(attach.op, "effect.attach");
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("gear").attachedTo, kernel.ref("host"));
  assert.deepEqual(run.linked.attached, { count: 1, objects: [kernel.ref("gear")], host: kernel.ref("host") });
  assert.deepEqual(run.result.linkedValues, run.linked);
  assert.deepEqual(run.events.map(event => event.action), ["attach"]);
  assert.equal(kernel.getObject("gear").energy, null);
  assert.equal(kernel.getObject("gear").power, null);
});

for (const status of ["replaced", "prevented", "impossible"]) {
  test(`effect.attach returns negated when attach is ${status}`, () => {
    const kernel = setup();
    kernel.addReplacement(action => action.type === "attach" ? status : null);
    const run = runInstruction(attach, args, { world: kernel, targets: targets(kernel) });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "replaced" ? "replaced" : "impossible");
    assert.equal(kernel.getObject("gear").attachedTo, null);
    assert.equal(run.linked.attached.count, 0);
    assert.equal(run.events[0].outcome, status);
  });
}

test("effect.attach ignores all stale targets after leaving and returning with a new zoneEntryId", () => {
  const kernel = setup();
  const locked = targets(kernel);
  for (const id of ["gear", "host"]) {
    assert.equal(kernel.perform({ type: "return-to-hand", object: kernel.ref(id) }).status, "done");
    assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref(id), to: "battlefield", location: battlefield }).status, "done");
  }
  const before = kernel.stateForTest();
  const run = runInstruction(attach, args, { world: kernel, targets: locked });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(run.linked, {});
  assert.notDeepEqual(kernel.ref("gear"), locked.equipment[0]);
});

test("effect.attach ignores a lost host target while its non-target source remains", () => {
  const kernel = setup();
  const host = kernel.ref("host");
  assert.equal(kernel.perform({ type: "kill", object: host }).status, "done");
  const run = runInstruction(attach, { host: target("unit") }, { world: kernel, targets: { unit: [host] } });
  assert.equal(run.result.status, "ignored");
  assert.equal(kernel.getObject("gear").attachedTo, null);
});

test("effect.attach zero amount performs no action or choice and links zero", () => {
  const kernel = setup();
  const run = runInstruction(attach, {
    objects: choose("equipment-choice", { type: "gear" }),
    host: choose("host-choice", { type: "unit" }), amount: literal(0)
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.attached, { count: 0, objects: [], host: null });
});

test("effect.attach amount exceeding available objects attaches only distinct available references", () => {
  const kernel = setup();
  const locked = targets(kernel);
  locked.equipment.push(kernel.ref("gear"));
  const run = runInstruction(attach, { ...args, amount: literal(99) }, { world: kernel, targets: locked });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.attached.count, 1);
  assert.equal(run.events.length, 1);
});

test("effect.attach stale non-target picks are impossible rather than mistargeted", () => {
  const kernel = setup();
  const old = kernel.ref("gear");
  assert.equal(kernel.perform({ type: "return-to-hand", object: old }).status, "done");
  const run = runInstruction(attach, { objects: pick("equipment"), host: pick("unit") }, {
    world: kernel, picks: { equipment: [old], unit: [kernel.ref("host")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.attached.count, 0);
});

test("effect.attach keeps legal targets and records partial success after a replacement", () => {
  const kernel = world().object("blocked", equipment("blocked")).object("gear", equipment("gear")).unit("host").build();
  kernel.addReplacement(action => action.type === "attach" && action.object.id === "blocked" ? "replaced" : null);
  const run = runInstruction(attach, { ...args, amount: literal(3) }, {
    world: kernel,
    targets: { equipment: [kernel.ref("blocked"), { id: "gone", zoneEntryId: 1 }, kernel.ref("gear")], unit: [kernel.ref("host")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(run.events.map(event => event.outcome ?? "done"), ["replaced", "done"]);
  assert.equal(kernel.getObject("blocked").attachedTo, null);
  assert.deepEqual(run.linked.attached.objects, [kernel.ref("gear")]);
  assert.equal(run.linked.attached.count, 1);
});

test("effect.attach chooses non-target objects transactionally and replays with the answer", () => {
  const kernel = world().object("z", equipment("z")).object("a", equipment("a")).unit("host").build();
  const selectedArgs = { objects: choose("equipment-choice", { type: "gear", controller: "A" }), host: pick("unit"), amount: literal(99) };
  const options = { world: kernel, picks: { unit: [kernel.ref("host")] } };
  const before = kernel.stateForTest();
  const run = runInstruction(attach, selectedArgs, options);
  assert.ok(run.asked instanceof AwaitChoice);
  assert.equal(run.result, null);
  assert.deepEqual(run.asked.request, {
    id: "equipment-choice", type: "select-objects", chooser: "A", visibility: "public",
    options: [kernel.ref("a"), kernel.ref("z")], min: 2, max: 2
  });
  assert.deepEqual(kernel.stateForTest(), before);
  const replayed = runInstruction(attach, selectedArgs, {
    ...options, answers: { "equipment-choice": [kernel.ref("z"), kernel.ref("a")] }
  });
  assert.equal(replayed.result.status, "executed");
  assert.equal(replayed.linked.attached.count, 2);
  assert.deepEqual(replayed.linked.attached.objects, [kernel.ref("z"), kernel.ref("a")]);
});

test("sfd-022-221 M1 Rumble Long Sword Quick-Draw attaches the source to a chosen friendly Unit", () => {
  const kernel = withSource(world().object("long-sword", equipment("long-sword", { cardId: "sfd-022-221" })).unit("rumble").unit("enemy", { owner: "B" }).build(), "long-sword");
  const selectedArgs = { host: choose("quick-draw-unit", { type: "unit", controller: "A" }) };
  const asked = runInstruction(attach, selectedArgs, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.deepEqual(asked.asked.request.options, [kernel.ref("rumble")]);
  const run = runInstruction(attach, selectedArgs, { world: kernel, answers: { "quick-draw-unit": [kernel.ref("rumble")] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("long-sword").attachedTo, kernel.ref("rumble"));
  assert.equal(run.linked.attached.count, 1);
});

test("sfd-095-221 M1 Fiora Doran's Blade Equip uses its locked Unit target", () => {
  const kernel = withSource(world().object("dorans-blade", equipment("dorans-blade", { cardId: "sfd-095-221" })).unit("fiora").build(), "dorans-blade");
  const run = runInstruction(attach, { host: target("equip-unit") }, { world: kernel, targets: { "equip-unit": [kernel.ref("fiora")] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("dorans-blade").attachedTo, kernel.ref("fiora"));
  assert.deepEqual(run.events.map(event => event.action), ["attach"]);
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.continuousEffects, []);
});

test("sfd-099-221 M1 Fiora Veteran Poro Weaponmaster re-attaches already attached Equipment", () => {
  const kernel = world().object("gear", equipment("gear")).unit("old-host").unit("poro", { cardId: "sfd-099-221" }).build();
  assert.equal(kernel.perform({ type: "attach", object: kernel.ref("gear"), host: kernel.ref("old-host") }).status, "done");
  const before = kernel.ref("gear");
  const run = runInstruction(attach, { objects: pick("equipment"), host: pick("played-unit") }, {
    world: kernel, picks: { equipment: [before], "played-unit": [kernel.ref("poro")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("gear").attachedTo, kernel.ref("poro"));
  assert.deepEqual(kernel.ref("gear"), before);
  assert.deepEqual(run.events.map(event => event.action), ["attach"]);
});

test("effect.attach to the current host is a no-effect execution with zero actual attachments", () => {
  const kernel = setup();
  assert.equal(kernel.perform({ type: "attach", object: kernel.ref("gear"), host: kernel.ref("host") }).status, "done");
  const before = kernel.stateForTest();
  const run = runInstruction(attach, args, { world: kernel, targets: targets(kernel) });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.attached.count, 0);
  assert.equal(run.events.length, 0);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.attach preserves separate controllers, readiness, damage, and printed values", () => {
  const kernel = world().object("gear", equipment("gear", { controller: "B", owner: "B", exhausted: true })).unit("host", { damage: 1 }).build();
  const before = kernel.getObject("gear");
  const run = runInstruction(attach, args, { world: kernel, targets: targets(kernel) });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("gear"), { ...before, attachedTo: kernel.ref("host") });
  assert.equal(kernel.getObject("host").controller, "A");
  assert.equal(kernel.getObject("host").damage, 1);
  assert.deepEqual(kernel.continuousEffects, []);
});

test("effect.attach cannot attach a Unit or use a non-Unit host", () => {
  for (const locked of [
    kernel => ({ equipment: [kernel.ref("other")], unit: [kernel.ref("host")] }),
    kernel => ({ equipment: [kernel.ref("gear")], unit: [kernel.ref("gear")] })
  ]) {
    const kernel = setup();
    const run = runInstruction(attach, args, { world: kernel, targets: locked(kernel) });
    assert.equal(run.result.status, "negated");
    assert.equal(run.linked.attached.count, 0);
    assert.equal(kernel.getObject("gear").attachedTo, null);
    assert.equal(kernel.getObject("other").attachedTo, null);
  }
});

test("effect.attach evaluates linked amounts and custom result keys", () => {
  const kernel = setup();
  const run = runInstruction(attach, {
    ...args, amount: { kind: "linked-value", instructionId: "prior", key: "amount" }, linkKey: literal("equipped")
  }, { world: kernel, targets: targets(kernel), linked: { amount: 1 } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.equipped.count, 1);
  assert.equal(run.linked.attached, undefined);
});

test("effect.attach rejects invalid arguments, counts, and forged choice answers", () => {
  for (const invalid of [null, {}, { host: "unit" }, { host: target("unit"), amount: 1 }, { ...args, extra: literal(1) }, { host: { kind: "unknown" } }]) {
    assert.throws(() => attach.argsSchema.parse(invalid), TypeError);
  }
  for (const amount of [-1, 1.5, Infinity, "1"]) {
    const kernel = setup();
    assert.throws(() => runInstruction(attach, { ...args, amount: literal(amount) }, { world: kernel, targets: targets(kernel) }), TypeError);
    assert.equal(kernel.events.length, 0);
  }
  for (const answer of [[], [{ id: "unknown", zoneEntryId: 1 }], [{ id: "host", zoneEntryId: 1 }, { id: "host", zoneEntryId: 1 }]]) {
    const kernel = setup();
    assert.throws(() => runInstruction(attach, { objects: source, host: choose("unit", { type: "unit" }) }, {
      world: kernel, answers: { unit: answer }
    }), TypeError);
    assert.equal(kernel.events.length, 0);
  }
});
