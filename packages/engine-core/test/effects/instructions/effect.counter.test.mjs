import assert from "node:assert/strict";
import test from "node:test";
import counter from "../../../dist/effects/instructions/effect.counter.js";
import { AwaitChoice, runInstruction, world } from "../../../dist/effects/testing/index.js";

const constant = value => ({ kind: "constant", value });
const chainSpell = (id, owner = "B") => ({
  zone: "chain",
  owner,
  controller: owner,
  types: ["spell"],
  cardId: id
});

test("SFD-206/221 Riposte counter clause resolves a Chain spell and links the actual count", () => {
  const kernel = world().object("spell", chainSpell("spell")).build();
  const spell = kernel.ref("spell");
  const run = runInstruction(counter, { target: "chain-item", amount: constant(1) }, {
    world: kernel,
    targets: { "chain-item": [spell] }
  });

  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.countered, 1);
  assert.deepEqual(run.linked.counteredObjects, [{ id: "spell", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("spell").zone, "trash");
  assert.equal(kernel.object(spell), null);
  assert.equal(run.events[0].action, "counter");
});

test("counter maps a replacement hook to negated without clearing the Chain", () => {
  const kernel = world().object("spell", chainSpell("spell")).build();
  const spell = kernel.ref("spell");
  kernel.addReplacement(action => action.type === "counter" ? "replaced" : null);
  const run = runInstruction(counter, { target: "chain-item" }, {
    world: kernel,
    targets: { "chain-item": [spell] }
  });

  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "replaced");
  assert.equal(kernel.object(spell).zone, "chain");
});

test("SFD-206/221 Riposte counter clause ignores a spell that left the Chain", () => {
  const kernel = world().object("spell", chainSpell("spell")).build();
  const stale = kernel.ref("spell");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  const run = runInstruction(counter, { target: "chain-item" }, {
    world: kernel,
    targets: { "chain-item": [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("spell").zone, "trash");
});

test("counter with amount zero executes no counter action and links zero", () => {
  const kernel = world()
    .object("spell-a", chainSpell("spell-a"))
    .object("spell-b", chainSpell("spell-b"))
    .build();
  const targets = [kernel.ref("spell-a"), kernel.ref("spell-b")];
  const run = runInstruction(counter, { target: "chain-items", amount: constant(0) }, {
    world: kernel,
    targets: { "chain-items": targets }
  });

  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.countered, 0);
  assert.equal(run.events.length, 0);
  assert.equal(kernel.object(targets[0]).zone, "chain");
  assert.equal(kernel.object(targets[1]).zone, "chain");
});

test("counter clamps an amount larger than the available target count", () => {
  const kernel = world().object("spell", chainSpell("spell")).build();
  const spell = kernel.ref("spell");
  const run = runInstruction(counter, { target: "chain-items", amount: constant(3) }, {
    world: kernel,
    targets: { "chain-items": [spell] }
  });

  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.countered, 1);
  assert.equal(kernel.object(spell), null);
});

test("counter suspends for a partial target selection and commits on answer", () => {
  const kernel = world()
    .object("spell-a", chainSpell("spell-a"))
    .object("spell-b", chainSpell("spell-b"))
    .build();
  const spellA = kernel.ref("spell-a");
  const spellB = kernel.ref("spell-b");
  const options = { world: kernel, targets: { "chain-items": [spellA, spellB] } };
  const asked = runInstruction(counter, { target: "chain-items", amount: constant(1) }, options);

  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.result, null);
  assert.equal(kernel.object(spellA).zone, "chain");
  assert.equal(kernel.object(spellB).zone, "chain");

  const answered = runInstruction(counter, { target: "chain-items", amount: constant(1) }, {
    ...options,
    answers: { [asked.asked.request.id]: [spellB] }
  });
  assert.equal(answered.result?.status, "executed");
  assert.equal(answered.linked.countered, 1);
  assert.equal(kernel.object(spellA).zone, "chain");
  assert.equal(kernel.object(spellB), null);
});

test("VEN-015/166 Decree of Rage remains negated when its counter restriction replaces countering", () => {
  const kernel = world().object("decree", chainSpell("ven-015-166")).build();
  const decree = kernel.ref("decree");
  kernel.addReplacement(action => action.type === "counter" ? "prevented" : null);
  const run = runInstruction(counter, { target: "decree" }, {
    world: kernel,
    targets: { decree: [decree] }
  });

  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "impossible");
  assert.equal(kernel.object(decree).zone, "chain");
});

test("UNL-190/219 Lilting Lullaby counters a spell and clears it from the Chain", () => {
  const kernel = world().object("spell", chainSpell("unl-190-219-target")).build();
  const spell = kernel.ref("spell");
  const run = runInstruction(counter, { target: "spell" }, {
    world: kernel,
    targets: { spell: [spell] }
  });

  assert.equal(run.result?.status, "executed");
  assert.equal(kernel.getObject("spell").zone, "trash");
  assert.equal(run.events[0].action, "counter");
});

test("counter maps prevented and impossible action outcomes to negated", () => {
  for (const status of ["prevented", "impossible"]) {
    const kernel = world().object("spell", chainSpell(`spell-${status}`)).build();
    const spell = kernel.ref("spell");
    kernel.addReplacement(action => action.type === "counter" ? status : null);
    const run = runInstruction(counter, { target: "chain-item" }, {
      world: kernel,
      targets: { "chain-item": [spell] }
    });

    assert.equal(run.result?.status, "negated");
    assert.equal(run.result?.reason, "impossible");
    assert.equal(kernel.object(spell).zone, "chain");
  }
});
