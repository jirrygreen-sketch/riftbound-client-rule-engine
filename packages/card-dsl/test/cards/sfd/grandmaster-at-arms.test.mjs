import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/grandmaster-at-arms.js";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { ChainEngine } = await import(new URL("chain/engine.js", ENGINE));
const { AwaitChoice } = await import(new URL("effects/contract.js", ENGINE));
const { bindResolveContext, createActionPipelineHost } = await import(new URL("events/action-adapter.js", ENGINE));
const { matchesObjectFilter } = await import(new URL("layers/filter.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));
const { ProgramRegistry } = await import(new URL("programs/registry.js", ENGINE));
const { describeActivate } = await import(new URL("programs/activate.js", ENGINE));

const CANONICAL_ID = "card.hash-9ce83a420f4ca5ab0a7f43d95f5f4a698cd4c4b8ca2b7453cfdad2c9ae9f38ef";
const SOURCE_TEXT =
  ":rb_energy_1:, :rb_exhaust:: Attach a detached Equipment you control to a unit you control.\n" +
  ":rb_exhaust:: Attach an attached Equipment you control to a unit you control.";

const [detachedAbility, attachedAbility] = program.abilities;

/**
 * A real chain fixture: the legend plus one attached/non-attached Equipment and two
 * Units, driven through the merged ChainEngine by supplying the draft. Program
 * registration exists; this only covers the Board-source subpath while Legend
 * Zone is unavailable (see judgeReason). The
 * answer map provides the Finalize-locked target choices, exactly as the merged
 * target pipeline supplies them.
 */
function fixture(answers = {}) {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .base("jax", { types: ["legend"], might: null, energy: null, power: null, location: { type: "base", player: "A" } })
    .base("blade", { types: ["gear"], tags: ["Equipment"], might: null, energy: 1, power: null, location: { type: "base", player: "A" } })
    .base("enemy-blade", { types: ["gear"], tags: ["Equipment"], might: null, energy: 1, power: null, owner: "B", controller: "B", location: { type: "base", player: "B" } })
    .unit("soldier", { zone: "board", location: { type: "base", player: "A" } })
    .unit("second", { zone: "board", location: { type: "base", player: "A" } })
    .build();
  const decide = (request) => {
    if (!(request.id in answers)) throw new AwaitChoice(request);
    return answers[request.id];
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return { engine, kernel };
}

function activate({ engine, kernel }, id, ability) {
  engine.execute({
    id,
    controller: "A",
    source: kernel.getObject("jax"),
    kind: "activated",
    speed: "action",
    cost: { id: `${id}:cost`, cost: ability.cost },
    body: ability.body
  });
  while (engine.items.length) engine.pass(engine.priority);
}

test("sfd-193-221 Grandmaster at Arms: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-193-221 Grandmaster at Arms: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /createProgramBinding/);
  assert.match(program.judgeReason, /Legend Zone/);
  assert.match(program.judgeReason, /107\.4\.c/);
});

test("sfd-193-221 Grandmaster at Arms: two action-speed activated abilities with the printed costs", () => {
  assert.equal(program.abilities.length, 2);

  // Ability 1: 1 Energy plus the exhaust symbol (404.1.a / 415.5).
  assert.equal(detachedAbility.kind, "activated");
  assert.equal(detachedAbility.timing, "action");
  assert.deepEqual(detachedAbility.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    payments: [{ kind: "exhaust", object: "self" }]
  });

  // Ability 2: only the exhaust symbol.
  assert.equal(attachedAbility.kind, "activated");
  assert.equal(attachedAbility.timing, "action");
  assert.deepEqual(attachedAbility.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });

  // Neither ability carries a restriction, and each body is one real attach.
  assert.equal(detachedAbility.restriction, undefined);
  assert.equal(attachedAbility.restriction, undefined);
  assert.deepEqual(detachedAbility.body.map((instruction) => [instruction.id, instruction.op]), [
    ["grandmaster-at-arms.attach-detached", "effect.attach"]
  ]);
  assert.deepEqual(attachedAbility.body.map((instruction) => [instruction.id, instruction.op]), [
    ["grandmaster-at-arms.reattach-attached", "effect.attach"]
  ]);
});

test("sfd-193-221 Grandmaster at Arms: the two Equipment selectors distinguish detached from attached", () => {
  const [attachDetached] = detachedAbility.body;
  const [reattachAttached] = attachedAbility.body;
  const [detachedEquipment, unitA] = attachDetached.targets;
  const [attachedEquipment, unitB] = reattachAttached.targets;

  // Ability 1 targets a detached, controlled Equipment and a controlled Unit.
  assert.deepEqual(detachedEquipment, {
    id: "grandmaster-at-arms.detached-equipment",
    filter: {
      type: "gear",
      tags: ["Equipment"],
      controller: "self",
      zone: "board",
      characteristics: { attachedTo: null }
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(unitA, {
    id: "grandmaster-at-arms.unit-a",
    filter: { type: "unit", controller: "self", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // Ability 2 targets an attached, controlled Equipment and a controlled Unit.
  assert.deepEqual(attachedEquipment, {
    id: "grandmaster-at-arms.attached-equipment",
    filter: {
      type: "gear",
      tags: ["Equipment"],
      controller: "self",
      zone: "board",
      states: "attached"
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(unitB, {
    id: "grandmaster-at-arms.unit-b",
    filter: { type: "unit", controller: "self", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // The merged matcher really separates the two states, and "you control" is not
  // an opponent's Equipment.
  // The visitor supplies the production binding of 190.6.d's "you"; the object's
  // own controller is independent so "not an opponent's Equipment" is a real check.
  const filtered = (filter, { attachedTo, ownerController = "A", boundTo = "A" }) => matchesObjectFilter(
    { ...filter, controller: boundTo },
    {
      ref: { id: "blade", zoneEntryId: 1 },
      cardId: "card:blade",
      name: "blade",
      types: ["gear"],
      tags: ["Equipment"],
      keywords: [],
      owner: ownerController,
      controller: ownerController,
      zone: "board",
      location: { type: "base", player: ownerController },
      might: null,
      energy: 1,
      power: null,
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo,
      faceDown: false,
      isToken: false
    }
  );
  assert.equal(filtered(detachedEquipment.filter, { attachedTo: null }), true);
  assert.equal(filtered(detachedEquipment.filter, { attachedTo: { id: "soldier", zoneEntryId: 1 } }), false);
  assert.equal(filtered(attachedEquipment.filter, { attachedTo: { id: "soldier", zoneEntryId: 1 } }), true);
  assert.equal(filtered(attachedEquipment.filter, { attachedTo: null }), false);
  assert.equal(filtered(detachedEquipment.filter, { attachedTo: null, ownerController: "B", boundTo: "A" }), false);
  assert.equal(filtered(attachedEquipment.filter, { attachedTo: { id: "soldier", zoneEntryId: 1 }, ownerController: "B", boundTo: "A" }), false);
});

test("sfd-193-221 Grandmaster at Arms: ability 1 charges 1 Energy + Exhaust and attaches the detached Equipment", () => {
  // The Finalize-locked targets come from the fixture (355.10 / 355.9.a.1); the
  // merged cost plan charges the printed cost before resolution.
  const { kernel: probe } = fixture();
  const answers = {
    "target:grandmaster-at-arms.detached-equipment": [probe.ref("blade")],
    "target:grandmaster-at-arms.unit-a": [probe.ref("soldier")]
  };
  const fixtureRun = fixture(answers);
  const { engine, kernel } = fixtureRun;

  assert.equal(kernel.getObject("blade").attachedTo, null);
  activate(fixtureRun, "gma:one", detachedAbility);

  assert.deepEqual(kernel.getObject("blade").attachedTo, kernel.ref("soldier"));
  assert.equal(kernel.getObject("jax").exhausted, true);
  assert.equal(kernel.player("A").energy, 19, "the printed 1 Energy was paid");
  assert.deepEqual(kernel.events.map((event) => event.action).filter(Boolean), ["pay", "exhaust", "attach"]);
  // Only the controller's own Board objects are re-zoned; the opponent's Equipment
  // stays untouched in its owner's Base (718.5.e-f: control does not travel with
  // an attach).
  assert.deepEqual(kernel.zone("A", "board").map((ref) => ref.id), ["jax", "blade", "soldier", "second"]);
  assert.deepEqual(kernel.zone("B", "board").map((ref) => ref.id), ["enemy-blade"]);
  assert.equal(kernel.getObject("enemy-blade").attachedTo, null);
});

test("sfd-193-221 Grandmaster at Arms: ability 2 charges Exhaust only and re-attaches the attached Equipment", () => {
  // 435.1.f: attaching to a new Top-Most card detaches it from the old one;
  // 435.4: it follows the new host's location. One attach action does both.
  const { kernel: probe } = fixture();
  probe.perform({ type: "attach", object: probe.ref("blade"), host: probe.ref("soldier") });
  const answers = {
    "target:grandmaster-at-arms.attached-equipment": [probe.ref("blade")],
    "target:grandmaster-at-arms.unit-b": [probe.ref("second")]
  };
  const fixtureRun = fixture(answers);
  const { engine, kernel } = fixtureRun;
  kernel.perform({ type: "attach", object: kernel.ref("blade"), host: kernel.ref("soldier") });
  const eventsBefore = kernel.events.length;

  activate(fixtureRun, "gma:two", attachedAbility);

  assert.deepEqual(kernel.getObject("blade").attachedTo, kernel.ref("second"));
  assert.equal(kernel.getObject("jax").exhausted, true);
  assert.equal(kernel.player("A").energy, 20, "ability 2 prints no Energy cost");
  assert.deepEqual(kernel.events.slice(eventsBefore).map((event) => event.action).filter(Boolean), ["pay", "exhaust", "attach"]);
});

test("sfd-193-221 Grandmaster at Arms: re-attaching to the current host is a no-op (435.1.g)", () => {
  // The kernel's attach action and effect.attach's own guard leave the attachment
  // unchanged when the chosen host is already the Top-Most card.
  const { kernel: probe } = fixture();
  probe.perform({ type: "attach", object: probe.ref("blade"), host: probe.ref("soldier") });
  const answers = {
    "target:grandmaster-at-arms.attached-equipment": [probe.ref("blade")],
    "target:grandmaster-at-arms.unit-b": [probe.ref("soldier")]
  };
  const fixtureRun = fixture(answers);
  const { kernel } = fixtureRun;
  kernel.perform({ type: "attach", object: kernel.ref("blade"), host: kernel.ref("soldier") });

  activate(fixtureRun, "gma:same", attachedAbility);

  assert.deepEqual(kernel.getObject("blade").attachedTo, kernel.ref("soldier"));
  assert.equal(kernel.getObject("jax").exhausted, true);
});

test("sfd-193-221 Grandmaster at Arms: an exhausted source cannot pay either printed ability cost", () => {
  for (const ability of program.abilities) {
    const base = world().player("A", { energy: 2 }).base("jax", { types: ["legend"], energy: null, power: null }).build();
    assert.equal(base.perform({ type: "exhaust", object: base.ref("jax") }).status, "done");
    const kernel = base.clone({ sourceSnapshot: base.getObject("jax") });
    const plan = buildCostPlan(kernel, { id: "gma:exhausted", cost: ability.cost });
    const before = kernel.events.length;
    assert.throws(() => payCostPlan(kernel, plan), error => {
      assert.equal(error.reason, "cannot-pay-cost");
      return true;
    });
    assert.equal(kernel.player("A").energy, 2);
    assert.equal(kernel.getObject("jax").exhausted, true);
    assert.equal(kernel.events.length, before);
    assert.equal(kernel.getObject("jax").energy, null);
    assert.equal(kernel.getObject("jax").power, null);
  }
});

test("sfd-193-221 Grandmaster at Arms: both activations bind through the merged program adapter", () => {
  // The status stays judge-required for the Legend Zone gap, but the binding
  // itself is not the gap: the merged adapter produces both drafts with the
  // printed cost and the card's own locked targets.
  const { judgeReason, ...binding } = program;
  const registry = new ProgramRegistry([{ ...binding, status: "executable" }]);
  const kernel = world()
    .unit("jax", { cardId: CANONICAL_ID, types: ["legend"], energy: null, power: null, might: null })
    .build();
  const source = kernel.getObject("jax");
  for (const [index, ability] of program.abilities.entries()) {
    const draft = describeActivate(registry, source, "A", index);
    assert.equal(draft.kind, "activated");
    assert.equal(draft.speed, "action");
    assert.deepEqual(draft.cost.cost, ability.cost);
    assert.deepEqual(draft.body.map((instruction) => [instruction.id, instruction.op]), [
      ability.body.map((instruction) => [instruction.id, instruction.op])[0]
    ]);
    assert.deepEqual(
      draft.body[0].targets.map((target) => target.id),
      ability.body[0].targets.map((target) => target.id)
    );
  }
});

test("sfd-193-221 Grandmaster at Arms: the printed exhaust cost cannot be paid from a Legend's real zone", () => {
  // 107.4.c places the Champion Legend in the Legend Zone, which has no ZoneId
  // in the frozen primitive contract. cost/payment.ts checks the exhaust host
  // against board/rune-zone only (415.4/415.5), so a Legend cannot pay it until
  // that shared binding exists. The card file keeps the printed cost declared
  // and does not approximate the payment.
  for (const zone of ["hand", "deck", "trash", "banishment"]) {
    const base = world().player("A", { energy: 2 }).object("legend", {
      types: ["legend"], energy: null, power: null, might: null
    }).build();
    base.perform({ type: "move-zone", object: base.ref("legend"), to: zone === "deck" ? "deck-top" : zone });
    const kernel = base.clone({ sourceSnapshot: base.getObject("legend") });
    const plan = buildCostPlan(kernel, { id: `gma:${zone}`, cost: detachedAbility.cost });
    assert.throws(() => payCostPlan(kernel, plan), error => {
      assert.equal(error.reason, "cannot-pay-cost");
      assert.match(error.message, /Board|rune-zone/);
      return true;
    });
    assert.equal(kernel.player("A").energy, 2);
  }
});

test.todo(
  "sfd-193-221 Grandmaster at Arms: use the merged createProgramBinding to offer both activations " +
  "from the actual Legend Zone after its source-zone and exhaust-payment binding exists"
);

test.todo(
  "sfd-193-221 Grandmaster at Arms: the Champion Legend's own zone is the Legend Zone " +
    "(CR 107.4.c); the frozen ZoneId union has no legend-zone, so “exhaust me” cannot cite the " +
    "legend's real zone in production (shared contract gap, not specific to this card)"
);
