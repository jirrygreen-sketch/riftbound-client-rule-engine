import assert from "node:assert/strict";
import test from "node:test";

import forgottenRelic from "../../../card-dsl/dist/cards/ven/forgotten-relic.js";
import { runInstruction, world } from "../../dist/effects/testing/index.js";
import { instructionDefinitionsById } from "../../dist/effects/instructions/registry.generated.js";
import triggerReflexive from "../../dist/effects/instructions/trigger.reflexive.js";
import {
  installReflexivePendingRuntime,
  reflexivePendingRuntimeFor,
} from "../../dist/effects/reflexive/runtime.js";
import { fixture, pendingItems, resolvedItems, settle } from "../rules/keywords/support.mjs";

const constant = value => ({ kind: "constant", value });
const executable = program => ({ ...program, status: "executable", judgeReason: undefined });

function relicFixture({ deck = ["burned"], burnedTypes = ["unit"], might = 3, answers = {} } = {}) {
  const program = executable(forgottenRelic);
  const f = fixture({
    programs: [program],
    energy: { A: 5 },
    answers: { "target:forgotten-relic.friendly-unit": ["friend"], ...answers },
    setup(builder) {
      builder.unit("relic", {
        cardId: program.canonicalCardId,
        types: ["gear"],
        energy: 5,
        power: null,
      });
      builder.unit("friend", { owner: "A", might: 2, location: { type: "battlefield", id: "bf" } });
      if (deck.length) builder.deck(deck, { owner: "A", types: burnedTypes, might });
    },
  });
  f.binding.registerProgramTriggers(f.engine, f.kernel.getObject("relic"));
  const runtime = installReflexivePendingRuntime(f.engine);
  return { ...f, runtime };
}

function finishChain(f) {
  let guard = 0;
  while (f.engine.items.length) {
    assert.ok(++guard < 20, "chain must settle");
    f.engine.pass(f.engine.priority);
  }
}

test("trigger.reflexive is registered and rejects malformed declarations", () => {
  assert.equal(instructionDefinitionsById.get("trigger.reflexive"), triggerReflexive);
  assert.throws(
    () => triggerReflexive.argsSchema.parse({ body: constant([]), unexpected: constant(true) }),
    /Invalid trigger\.reflexive argument: unexpected/,
  );
  assert.throws(
    () => triggerReflexive.argsSchema.parse({ body: constant([]), objects: constant([]), burned: constant([]) }),
    /accepts objects or burned, not both/,
  );
});

test("the primitive fails closed without the production Pending runtime", () => {
  const kernel = world().deck("burned").build();
  const run = runInstruction(triggerReflexive, {
    at: constant("card-burned"),
    body: constant([]),
  }, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(reflexivePendingRuntimeFor(kernel.source), undefined);
});

test("Forgotten Relic's original IR creates a new Pending item from the Burn result", () => {
  const f = relicFixture();
  f.engine.emit({ timingPoint: "beginning-start", player: "A" });
  f.engine.advance();
  assert.deepEqual(f.asked.map(request => request.id), [], "the source trigger has no target or may choice");

  f.engine.pass("A");
  f.engine.pass("B");

  const [reflexive] = f.engine.items;
  assert.equal(reflexive?.status, "finalized");
  assert.match(reflexive?.id ?? "", /^reflexive:trigger:1:forgotten-relic\.burned-card:1$/);
  assert.equal(reflexive?.controller, "A");
  assert.deepEqual(reflexive?.body.map(instruction => instruction.op), ["continuous.might"]);
  assert.deepEqual(reflexive?.targetPlans.map(plan => plan.selected.map(ref => ref.id)), [["friend"]]);
  assert.deepEqual(f.asked.map(request => request.id), ["target:forgotten-relic.friendly-unit"]);
  assert.ok(f.engine.trace.some(entry => entry.step === "pending" && entry.item === reflexive?.id));
  assert.ok(f.engine.trace.some(entry => entry.step === "finalized" && entry.item === reflexive?.id));
  assert.equal(f.runtime.snapshots.length, 1);
  assert.deepEqual(f.runtime.snapshots[0]?.matched.map(ref => ref.id), ["burned"]);
  assert.equal(f.runtime.snapshots[0]?.controller, "A");
  assert.equal(f.runtime.snapshots[0]?.conditionResult, true);
  assert.equal(f.runtime.snapshots[0]?.source.ref.id, "relic");
});

test("the Reflexive item resolves the originating result and applies its own target", () => {
  const f = relicFixture();
  f.engine.emit({ timingPoint: "beginning-start", player: "A" });
  f.engine.advance();
  settle(f.engine);

  assert.deepEqual(pendingItems(f.engine), ["trigger:1", "reflexive:trigger:1:forgotten-relic.burned-card:1"]);
  assert.deepEqual(resolvedItems(f.engine), pendingItems(f.engine));
  assert.deepEqual(
    f.engine.layers.registry.snapshot().map(entry => ({ kind: entry.effect.effect.kind, amount: entry.effect.effect.amount, duration: entry.duration })),
    [{ kind: "continuous.might", amount: 3, duration: { type: "end-of-turn" } }],
  );
  assert.equal(f.kernel.continuousEffects.length, 0, "production ChainEngine, not the reference kernel, owns the layer");
  assert.equal(f.snapshot("friend").might, 5);
  assert.equal(f.engine.layers.registry.snapshot().length, 1);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.runtime.snapshots.length, 0);
});

test("an empty Burn creates no Reflexive item", () => {
  const f = relicFixture({ deck: [] });
  for (const ref of f.kernel.zone("A", "deck")) {
    assert.equal(f.engine.commit({ type: "move-zone", object: ref, to: "hand" }).status, "done");
  }
  f.engine.advance();
  f.engine.emit({ timingPoint: "beginning-start", player: "A" });
  f.engine.advance();
  f.engine.pass("A");
  f.engine.pass("B");
  finishChain(f);

  assert.equal(f.asked.some(request => request.id === "target:forgotten-relic.friendly-unit"), false);
  assert.deepEqual(pendingItems(f.engine), ["trigger:1"]);
  assert.deepEqual(resolvedItems(f.engine), ["trigger:1"]);
  assert.equal(f.snapshot("friend").might, 2);
});

test("a burned non-unit does not satisfy Forgotten Relic's result filter", () => {
  const f = relicFixture({ burnedTypes: ["spell"] });
  f.engine.emit({ timingPoint: "beginning-start", player: "A" });
  f.engine.advance();
  settle(f.engine);

  assert.deepEqual(f.asked, []);
  assert.deepEqual(pendingItems(f.engine), ["trigger:1"]);
  assert.equal(f.snapshot("friend").might, 2);
});

test("an invalid Reflexive target choice rolls back the whole Finalize", () => {
  const f = relicFixture({
    answers: { "target:forgotten-relic.friendly-unit": [{ id: "friend", zoneEntryId: 999 }] },
  });
  f.engine.emit({ timingPoint: "beginning-start", player: "A" });
  f.engine.advance();
  assert.throws(
    () => {
      f.engine.pass("A");
      f.engine.pass("B");
    },
    error => /illegal target|no-legal-targets/i.test(String(error?.cause ?? error)),
  );
  assert.equal(f.engine.items.length, 1);
  assert.equal(f.engine.items[0]?.status, "pending");
  assert.equal(f.asked.length, 1);
  assert.equal(f.engine.trace.some(entry => entry.step === "finalized" && entry.item?.startsWith("reflexive:")), false);
  assert.equal(f.snapshot("friend").might, 2);
});

test("a stale Reflexive target is ignored at Resolve without granting Might", () => {
  const f = relicFixture();
  f.engine.emit({ timingPoint: "beginning-start", player: "A" });
  f.engine.advance();
  f.engine.pass("A");
  f.engine.pass("B");

  f.engine.commit({ type: "move-zone", object: f.kernel.ref("friend"), to: "hand" });
  f.engine.advance();
  finishChain(f);

  assert.deepEqual(resolvedItems(f.engine), ["trigger:1", "reflexive:trigger:1:forgotten-relic.burned-card:1"]);
  assert.equal(f.kernel.getObject("friend")?.might, 2);
  assert.equal(f.kernel.getObject("friend")?.zone, "hand");
});

test("leading may is stored on the new item and declined at its own Finalize", () => {
  const f = relicFixture({ answers: { "finalize:reflexive:reflexive-may-probe:forgotten-relic.burned-card:1:optional": false } });
  const source = f.kernel.getObject("relic");
  const [burn, reflexive] = forgottenRelic.abilities[1].body;
  const optionalReflexive = {
    ...reflexive,
    args: {
      ...reflexive.args,
      body: constant([{
        id: "forgotten-relic.optional-body",
        op: "choice.optional",
        args: {
          body: constant([{ id: "optional-draw", op: "effect.draw", args: { amount: constant(1) } }]),
        },
      }]),
    },
  };
  f.engine.execute({
    id: "reflexive-may-probe",
    controller: "A",
    source,
    kind: "triggered",
    body: [burn, optionalReflexive],
  });
  f.engine.advance();
  f.engine.pass("A");
  f.engine.pass("B");
  const itemId = "reflexive:reflexive-may-probe:forgotten-relic.burned-card:1";
  assert.ok(f.asked.some(request => request.id === `finalize:${itemId}:optional` && request.type === "optional"));
  assert.ok(f.engine.trace.some(entry => entry.step === "removed" && entry.item === itemId && entry.reason === "declined"));
  assert.deepEqual(f.engine.items, []);
});

test("multiple Reflexive items are created in order with distinct replay identities", () => {
  const f = relicFixture({ deck: ["one", "two"], burnedTypes: ["unit"] });
  const source = f.kernel.getObject("relic");
  const burn = { ...forgottenRelic.abilities[1].body[0], args: { amount: constant(2) } };
  const reflexive = forgottenRelic.abilities[1].body[1];
  f.engine.execute({
    id: "reflexive-order-probe",
    controller: "A",
    source,
    kind: "triggered",
    body: [burn, reflexive],
  });
  f.engine.advance();
  f.engine.pass("A");
  f.engine.pass("B");

  const ids = f.engine.items.map(item => item.id);
  assert.ok(ids.length >= 1);
  assert.equal(ids[0], "reflexive:reflexive-order-probe:forgotten-relic.burned-card:1");
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^reflexive:reflexive-order-probe:forgotten-relic\.burned-card:[1-9][0-9]*$/);
  assert.deepEqual(
    [...f.engine.trace.filter(entry => entry.step === "pending" && entry.item?.startsWith("reflexive:")).map(entry => entry.item)].sort(),
    [...ids].sort(),
  );
});

test("the creation snapshot keeps its controller after the source changes control", () => {
  const f = relicFixture();
  f.engine.emit({ timingPoint: "beginning-start", player: "A" });
  f.engine.advance();
  f.engine.pass("A");
  f.engine.pass("B");
  const [reflexive] = f.engine.items;
  const snapshot = f.runtime.snapshots[0];
  assert.equal(snapshot?.controller, "A");
  assert.equal(reflexive?.controller, "A");
  assert.equal(reflexive?.status, "finalized");

  assert.equal(f.engine.commit({ type: "take-control", object: f.kernel.ref("relic"), player: "B" }).status, "done");
  assert.equal(f.snapshot("relic").controller, "B");
  assert.equal(f.engine.items[0]?.controller, "A");
  assert.equal(f.runtime.snapshots[0]?.controller, "A");
  assert.equal(f.runtime.snapshots[0]?.source.controller, "A");
  f.engine.advance();
  finishChain(f);
  assert.equal(f.snapshot("friend").might, 5);
});

test("a repeated Reflexive execution gets a distinct deterministic identity", () => {
  const idsFor = () => {
    const f = relicFixture({ deck: ["one", "two"], burnedTypes: ["unit"] });
    const source = f.kernel.getObject("relic");
    const burn = forgottenRelic.abilities[1].body[0];
    const reflexive = forgottenRelic.abilities[1].body[1];
    f.engine.execute({
      id: "same-reflexive-wave",
      controller: "A",
      source,
      kind: "triggered",
      body: [burn, reflexive, { ...burn, id: "forgotten-relic.second-burn" }, {
        ...reflexive,
        id: "forgotten-relic.second-reflexive",
      }],
    });
    f.engine.advance();
    f.engine.pass("A");
    f.engine.pass("B");
    return f.engine.items.map(item => item.id);
  };
  assert.deepEqual(idsFor(), idsFor());
});

test("a rejected originating Burn creates no Reflexive item", () => {
  const f = relicFixture();
  f.kernel.addReplacement(action => action.type === "mill" ? "prevented" : null);
  f.engine.emit({ timingPoint: "beginning-start", player: "A" });
  f.engine.advance();
  f.engine.pass("A");
  f.engine.pass("B");
  finishChain(f);

  assert.equal(f.engine.trace.some(entry => entry.item?.startsWith("reflexive:")), false);
  assert.deepEqual(f.runtime.snapshots, []);
  assert.equal(f.asked.some(request => request.id === "target:forgotten-relic.friendly-unit"), false);
  assert.equal(f.snapshot("friend").might, 2);
});
