import assert from "node:assert/strict";
import test from "node:test";
import move from "../../../src/effects/instructions/effect.move.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";
import { bindResolveContext } from "../../../src/events/action-adapter.ts";

const literal = value => ({ kind: "constant", value });
const target = id => literal({ target: id });
const pick = id => literal({ pick: id });
const choose = (id, filter = { type: "unit" }, min) => literal({ kind: "choose", id, filter, ...(min === undefined ? {} : { min }) });
const base = player => ({ type: "base", player });
const battlefield = { type: "battlefield", id: "battlefield-1" };
const second = { type: "battlefield", id: "battlefield-2" };
const args = { objects: target("units"), to: literal(second) };
const withSource = (kernel, id) => kernel.clone({ sourceSnapshot: kernel.getObject(id) });
const setup = () => withSource(world().unit("unit", { might: 4, exhausted: true, damage: 2, buffs: 1, stunned: true, energy: null, power: null }).build(), "unit");
const targets = kernel => ({ units: [kernel.ref("unit")] });

test("effect.move submits a Move, preserves identity/statuses, and links actual origin/destination", () => {
  const kernel = setup();
  const before = kernel.getObject("unit");
  const run = runInstruction(move, args, { world: kernel, targets: targets(kernel) });
  assert.equal(move.op, "effect.move");
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
  assert.deepEqual(kernel.getObject("unit"), { ...before, location: second });
  assert.equal(kernel.history({ action: "move-location", object: before.ref }), 1);
  assert.deepEqual(run.linked.moved, {
    count: 1, objects: [before.ref], movements: [{ object: before.ref, from: battlefield, to: second }]
  });
  assert.deepEqual(run.result.linkedValues, run.linked);
});

for (const status of ["replaced", "prevented", "impossible"]) {
  test("effect.move returns negated when the Move is " + status, () => {
    const kernel = setup();
    kernel.addReplacement(action => action.type === "move-location" ? status : null);
    const run = runInstruction(move, args, { world: kernel, targets: targets(kernel) });
    assert.equal(run.result.status, "negated");
    assert.equal(run.result.reason, status === "prevented" ? "skipped" : status);
    assert.equal(run.events[0].outcome, status);
    assert.deepEqual(run.result.events, run.events);
    assert.deepEqual(kernel.getObject("unit").location, battlefield);
    assert.deepEqual(run.linked.moved, { count: 0, objects: [], movements: [] });
    assert.equal(kernel.history({ action: "move-location" }), 0);
  });
}

test("effect.move ignores all stale targets after leaving and re-entering the Board", () => {
  const kernel = setup();
  const locked = targets(kernel);
  assert.equal(kernel.perform({ type: "return-to-hand", object: locked.units[0] }).status, "done");
  assert.equal(kernel.perform({ type: "move-zone", object: kernel.ref("unit"), to: "battlefield", location: battlefield }).status, "done");
  const before = kernel.stateForTest();
  const run = runInstruction(move, args, { world: kernel, targets: locked });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked, {});
  assert.deepEqual(kernel.stateForTest(), before);
  assert.notDeepEqual(kernel.ref("unit"), locked.units[0]);
});

test("effect.move uses only surviving targets and deduplicates repeated references", () => {
  const kernel = setup();
  const run = runInstruction(move, { ...args, amount: literal(99) }, {
    world: kernel, targets: { units: [{ id: "gone", zoneEntryId: 1 }, kernel.ref("unit"), kernel.ref("unit")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 1);
  assert.equal(run.linked.moved.count, 1);
});

test("effect.move records partial results and continues after a negated action", () => {
  const kernel = world().unit("blocked").unit("a").unit("b").build();
  kernel.addReplacement(action => action.type === "move-location" && action.object.id === "blocked" ? "replaced" : null);
  const run = runInstruction(move, { ...args, amount: literal(3) }, {
    world: kernel, targets: { units: [kernel.ref("blocked"), kernel.ref("b"), kernel.ref("a")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.deepEqual(run.events.map(event => event.outcome ?? "done"), ["replaced", "done", "done"]);
  assert.deepEqual(run.linked.moved.objects, [kernel.ref("b"), kernel.ref("a")]);
  assert.equal(run.linked.moved.count, 2);
  assert.deepEqual(kernel.getObject("blocked").location, battlefield);
  assert.deepEqual(kernel.getObject("a").location, second);
});

test("effect.move amount zero makes no object/destination choice and links zero", () => {
  const kernel = setup();
  const before = kernel.stateForTest();
  const run = runInstruction(move, {
    objects: choose("objects"), to: literal({ kind: "choose", id: "destination", options: [second] }), amount: literal(0)
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked.moved, { count: 0, objects: [], movements: [] });
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.move bounds quantity by amount without substituting unrelated objects", () => {
  const kernel = world().unit("a").unit("b").unit("unselected").build();
  const run = runInstruction(move, args, { world: kernel, targets: { units: [kernel.ref("b"), kernel.ref("a")] } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.moved.objects, [kernel.ref("b")]);
  assert.deepEqual(kernel.getObject("a").location, battlefield);
  assert.deepEqual(kernel.getObject("unselected").location, battlefield);
});

test("effect.move non-target picks use each object's controller Base, not its owner or ability controller", () => {
  const kernel = world().unit("stolen", { owner: "A", controller: "B" }).unit("own").build();
  const run = runInstruction(move, { objects: pick("picked"), to: literal("controller-base"), amount: literal(5) }, {
    world: kernel, picks: { picked: ["A", "location-id", kernel.ref("stolen"), kernel.ref("own")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 2);
  assert.deepEqual(kernel.getObject("stolen").location, base("B"));
  assert.deepEqual(kernel.getObject("own").location, base("A"));
});

test("effect.move stale non-target picks negate the instruction without consulting last-known information", () => {
  const kernel = setup();
  const old = kernel.ref("unit");
  assert.equal(kernel.perform({ type: "kill", object: old }).status, "done");
  const run = runInstruction(move, { objects: pick("picked"), to: literal(second) }, { world: kernel, picks: { picked: [old] } });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.events.length, 0);
  assert.equal(run.linked.moved.count, 0);
  assert.equal(kernel.getObject("unit").zone, "trash");
});

test("effect.move source defaults to the ability source and a same-location destination moves nothing", () => {
  const kernel = setup();
  const before = kernel.stateForTest();
  const run = runInstruction(move, { to: literal(battlefield) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 0);
  assert.equal(run.events.length, 0);
  assert.deepEqual(kernel.stateForTest(), before);
  const moved = runInstruction(move, { objects: literal("self"), to: literal(second) }, { world: kernel });
  assert.equal(moved.linked.moved.count, 1);
});

test("effect.move enforces one shared destination rule for direct constants and linked values", () => {
  const kernel = world().unit("mover").unit("other", { owner: "B", location: second }).build();
  kernel.addPlayer("C", {});
  kernel.addObject({ ...kernel.getObject("other"), ref: { id: "c-unit", zoneEntryId: 1 }, owner: "C", controller: "C" }, "board");
  const blocked = runInstruction(move, { objects: target("units"), to: literal(second) }, {
    world: kernel, targets: { units: [kernel.ref("mover")] }
  });
  assert.equal(blocked.result.status, "negated");
  assert.equal(blocked.result.reason, "impossible");
  assert.equal(blocked.events.length, 0);
  assert.deepEqual(kernel.getObject("mover").location, battlefield);
  const linked = runInstruction(move, {
    objects: target("units"), to: { kind: "linked-value", instructionId: "location", key: "there" }
  }, { world: kernel, targets: { units: [kernel.ref("mover")] }, linked: { there: second } });
  assert.equal(linked.result.status, "negated");
  assert.equal(linked.result.reason, "impossible");
  assert.equal(linked.events.length, 0);
  assert.deepEqual(kernel.getObject("mover").location, battlefield);
});

test("effect.move rejects a common destination illegal for any selected object before moving", () => {
  const kernel = world().unit("a").unit("b").build();
  kernel.addPlayer("C", {});
  const b = kernel.getObject("b");
  kernel.addObject({ ...b, ref: { id: "enemy-b", zoneEntryId: 1 }, owner: "B", controller: "B", location: second }, "board");
  kernel.addObject({ ...b, ref: { id: "enemy-c", zoneEntryId: 1 }, owner: "C", controller: "C", location: second }, "board");
  const before = kernel.stateForTest();
  const run = runInstruction(move, { objects: target("units"), to: literal(second), amount: literal(2) }, {
    world: kernel, targets: { units: [kernel.ref("a"), kernel.ref("b")] }
  });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.events.length, 0);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.move suspends both non-target decisions and replays atomically with stable options", () => {
  const kernel = world().unit("z").unit("a").hand("not-on-board").build();
  const selectedArgs = {
    objects: choose("objects"), amount: literal(2),
    to: literal({ kind: "choose", id: "destination", options: [second, second, base("A")] })
  };
  const before = kernel.stateForTest();
  const asked = runInstruction(move, selectedArgs, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.deepEqual(asked.asked.request, {
    id: "objects", type: "select-objects", chooser: "A", visibility: "public",
    options: [kernel.ref("a"), kernel.ref("z")], min: 2, max: 2
  });
  assert.deepEqual(kernel.stateForTest(), before);
  const answers = { objects: [kernel.ref("z"), kernel.ref("a")] };
  const secondAsk = runInstruction(move, selectedArgs, { world: kernel, answers });
  assert.ok(secondAsk.asked instanceof AwaitChoice);
  assert.deepEqual(secondAsk.asked.request, {
    id: "destination", type: "mode", chooser: "A", visibility: "public", options: [second, base("A")]
  });
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(secondAsk.linked, {});
  const run = runInstruction(move, selectedArgs, { world: kernel, answers: { ...answers, destination: second } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.moved.objects, [kernel.ref("z"), kernel.ref("a")]);
  assert.equal(run.events.length, 2);
  assert.deepEqual(kernel.getObject("z").location, second);
  assert.equal(kernel.getObject("not-on-board").zone, "hand");
});

test("effect.move up-to selection accepts zero and does not request an unused destination", () => {
  const kernel = setup();
  const run = runInstruction(move, {
    objects: choose("objects", { type: "unit" }, 0), amount: literal(2),
    to: literal({ kind: "choose", id: "destination", options: [second] })
  }, { world: kernel, answers: { objects: [] } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.linked.moved.count, 0);
});

test("effect.move optional selection from an empty pool executes zero without a choice", () => {
  const kernel = world().hand("not-on-board").unit("not-a-permanent", { types: ["spell"] }).build();
  const run = runInstruction(move, {
    objects: choose("objects", {}, 0), to: literal(second), amount: literal(2)
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.asked, null);
  assert.equal(run.linked.moved.count, 0);
  assert.equal(run.events.length, 0);
});

test("effect.move selection exceeding available quantity asks for as many as possible", () => {
  const kernel = setup();
  const run = runInstruction(move, { objects: choose("objects"), to: literal(second), amount: literal(100) }, { world: kernel });
  assert.equal(run.asked.request.min, 1);
  assert.equal(run.asked.request.max, 1);
});

test("effect.move unavailable targets are ignored before reading an unavailable linked destination", () => {
  const kernel = setup();
  const run = runInstruction(move, {
    ...args, to: { kind: "linked", instructionId: "location", key: "gone-location" }
  }, { world: kernel, targets: { units: [] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.linked, {});
});

test("effect.move evaluates linked destinations and arithmetic amounts with a custom receipt key", () => {
  const kernel = setup();
  const run = runInstruction(move, {
    ...args, to: { kind: "linked-value", instructionId: "location", key: "there" },
    amount: { kind: "arithmetic", operator: "add", operands: [literal(0), literal(1)] }, linkKey: literal("travelled")
  }, { world: kernel, targets: targets(kernel), linked: { there: second } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.travelled.count, 1);
  assert.equal(run.linked.moved, undefined);
});

test("sfd-048-221 Stellacorn Herder Move is recorded for its When I move trigger; drawing belongs to the trigger pipeline", () => {
  // 原文：When I move, draw 1. 本例只验证供触发管线消费的真实移动记录；
  // 不以手动 draw 或伪造回调冒充整张卡牌已经接通。
  const kernel = withSource(world().base("herder", { cardId: "sfd-048-221", energy: 4, power: null, might: 3 }).deck(["top", "bottom"]).build(), "herder");
  const run = runInstruction(move, { to: literal(battlefield) }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("herder").location, battlefield);
  assert.equal(kernel.history({ action: "move-location", object: kernel.ref("herder") }), 1);
  assert.deepEqual(run.linked.moved.movements, [{ object: kernel.ref("herder"), from: base("A"), to: battlefield }]);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 2);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("unl-137-219 Sinister Poro moves its enemy-here target to its Base after the separate optional payment", () => {
  // 原文：When I attack, you may pay [1] to move an enemy unit here to its base.
  // 触发、可选支付与目标计划属上游；本例只调用付款后执行的移动指令。
  const kernel = world().player("A", { energy: 1 }).unit("poro", { cardId: "unl-137-219", energy: 2, power: ["Chaos"], might: 1 })
    .unit("enemy", { owner: "B", might: 2, exhausted: true, damage: 1 }).unit("elsewhere", { owner: "B", location: second }).build();
  assert.equal(kernel.perform({ type: "pay", player: "A", plan: { finalized: true, energy: 1 } }).status, "done");
  const run = runInstruction(move, { objects: target("enemy-here"), to: literal("controller-base") }, {
    world: kernel, targets: { "enemy-here": [kernel.ref("enemy")] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("enemy").location, base("B"));
  assert.equal(kernel.getObject("enemy").exhausted, true);
  assert.equal(kernel.getObject("enemy").damage, 1);
  assert.deepEqual(kernel.getObject("elsewhere").location, second);
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("ogs-011-024 Flash moves its two friendly targets to Base without readying or recalling them", () => {
  // 原文：Move up to 2 friendly units to base. Finalize 已锁定这两个目标；
  // 本原语不把 Reaction 的移动当作 Standard Move 或 Recall。
  const kernel = world().unit("one", { exhausted: true }).unit("two", { location: second, might: 3, damage: 2 })
    .unit("enemy", { owner: "B" }).build();
  const run = runInstruction(move, { ...args, to: literal("controller-base"), amount: literal(2) }, {
    world: kernel, targets: { units: [kernel.ref("one"), kernel.ref("two")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 2);
  assert.deepEqual(kernel.getObject("one").location, base("A"));
  assert.deepEqual(kernel.getObject("two").location, base("A"));
  assert.equal(kernel.getObject("one").exhausted, true);
  assert.equal(kernel.getObject("two").damage, 2);
  assert.deepEqual(kernel.getObject("enemy").location, battlefield);
  assert.deepEqual(run.events.map(event => event.action), ["move-location", "move-location"]);
});

test("effect.move recall submits an independent Recall action and never a Move (CR 457-460)", () => {
  const kernel = setup();
  const unit = kernel.getObject("unit");
  const calls = [];
  const target = kernel.clone();
  target.setTargets("units", [target.ref("unit")]);
  const context = bindResolveContext(target, {
    contractActions: {
      version: "riftbound.contract-actions.v1",
      perform: action => {
        calls.push(structuredClone(action));
        const current = target.getObject(action.object.id);
        const from = current.location;
        current.location = base(current.controller);
        target.addObject(current, "board");
        return { status: "done", events: [{ type: "task-resolved", seq: 1, turnNumber: 1, activePlayerId: "A", taskId: "recall:1", sourceCardId: "test", reason: "recall", autoResolved: true, action: "recall", details: { recall: true, from, to: current.location } }], receipt: { status: "committed", actions: [{ type: "recall", status: "done" }] } };
      },
    },
  });
  const parsed = move.argsSchema.parse({ ...args, to: literal("controller-base"), mode: literal("recall") });
  const result = move.execute(context, parsed);
  kernel.restore(target.snapshot());
  kernel.copyLinkedFrom(target);
  assert.equal(result.status, "executed");
  assert.deepEqual(calls, [{ type: "recall", object: unit.ref, player: "A" }]);
  assert.deepEqual(result.events.map(event => event.action), ["recall"]);
  assert.deepEqual(kernel.getObject("unit"), { ...unit, location: base("A") });
  assert.equal(kernel.getObject("unit").damage, 2);
  assert.equal(kernel.getObject("unit").exhausted, true);
  assert.equal(kernel.history({ action: "move-location" }), 0);
});

test("effect.move recall rejects a fake done result without a committed Recall receipt or observation", () => {
  for (const receipt of [undefined, { status: "rolled-back", actions: [{ type: "recall", status: "impossible" }] }]) {
    const kernel = setup();
    const before = kernel.stateForTest();
    const target = kernel.clone();
    target.setTargets("units", [target.ref("unit")]);
    const context = bindResolveContext(target, {
      contractActions: {
        version: "riftbound.contract-actions.v1",
        perform: () => ({ status: "done", events: [], ...(receipt === undefined ? {} : { receipt }) }),
      },
    });
    const parsed = move.argsSchema.parse({ ...args, to: literal("controller-base"), mode: literal("recall") });
    const result = move.execute(context, parsed);
    kernel.restore(target.snapshot());
    assert.equal(result.status, "negated");
    assert.equal(result.reason, "impossible");
    assert.deepEqual(target.linked("moved").blockedReason, "RecallAction consumer did not commit a preserved Recall with an independent observation");
    assert.deepEqual(target.getObject("unit").location, battlefield);
    assert.equal(target.history({ action: "recall" }), 0);
    assert.equal(target.history({ action: "move-location" }), 0);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("effect.move does not move cards from non-Board zones or non-permanents", () => {
  const kernel = world().hand("hand").unit("spell", { types: ["spell"] }).build();
  const before = kernel.stateForTest();
  const missing = runInstruction(move, args, { world: kernel, targets: { units: [kernel.ref("hand")] } });
  assert.equal(missing.result.status, "ignored");
  const impossible = runInstruction(move, args, { world: kernel, targets: { units: [kernel.ref("spell")] } });
  assert.equal(impossible.result.status, "negated");
  assert.equal(impossible.linked.moved.count, 0);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("effect.move rejects malformed expressions, unsafe quantities, and invalid evaluated arguments", () => {
  for (const invalid of [null, {}, { to: second }, { ...args, extra: literal(1) }, { ...args, amount: 1 },
    { to: { kind: "literal" } }, { ...args, amount: { kind: "arithmetic", operator: "neg", operands: [] } }]) {
    assert.throws(() => move.argsSchema.parse(invalid), TypeError);
  }
  for (const amount of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, null, "1"]) {
    const kernel = setup();
    assert.throws(() => runInstruction(move, { ...args, amount: literal(amount) }, { world: kernel, targets: targets(kernel) }), TypeError);
    assert.equal(kernel.events.length, 0);
  }
  for (const override of [{ mode: literal("teleport") }, { linkKey: literal("") }, { objects: literal({ id: "unit", zoneEntryId: 1 }) },
    { objects: literal({ target: "units", pick: "picked" }) },
    { to: literal({ type: "base", player: "" }) }, { to: literal({ kind: "choose", id: "to", options: [] }) }]) {
    const kernel = setup();
    assert.throws(() => runInstruction(move, { ...args, ...override }, { world: kernel, targets: targets(kernel) }), TypeError);
    assert.equal(kernel.events.length, 0);
  }
});

test("effect.move rejects forged object/destination choices without committing state", () => {
  for (const answer of [[], [null], [{ id: "unknown", zoneEntryId: 1 }], [{ id: "a", zoneEntryId: 1 }, { id: "a", zoneEntryId: 1 }]]) {
    const kernel = world().unit("a").unit("b").build();
    const before = kernel.stateForTest();
    assert.throws(() => runInstruction(move, { objects: choose("objects"), to: literal(second), amount: literal(2) }, {
      world: kernel, answers: { objects: answer }
    }), TypeError);
    assert.deepEqual(kernel.stateForTest(), before);
  }
  for (const answer of [null, { type: "battlefield", id: "forged" }]) {
    const kernel = setup();
    const before = kernel.stateForTest();
    assert.throws(() => runInstruction(move, { to: literal({ kind: "choose", id: "to", options: [second] }) }, {
      world: kernel, answers: { to: answer }
    }), TypeError);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("effect.move rejects choice id collisions", () => {
  const kernel = setup();
  assert.throws(() => runInstruction(move, {
    objects: choose("same"), to: literal({ kind: "choose", id: "same", options: [second] })
  }, { world: kernel }), /distinct ids/);
});

test("effect.move rejects an inconsistent non-target choice minimum", () => {
  const kernel = setup();
  assert.throws(() => runInstruction(move, {
    objects: choose("objects", { type: "unit" }, 2), to: literal(second), amount: literal(1)
  }, { world: kernel }), /min exceeds amount/);
  assert.equal(kernel.events.length, 0);
});

test("effect.move identical seeds and choice answers produce identical receipts, events, and state", () => {
  const first = setup();
  const secondWorld = setup();
  const run = kernel => runInstruction(move, { objects: choose("objects"), to: literal(second) }, {
    world: kernel, answers: { objects: [kernel.ref("unit")] }
  });
  assert.deepEqual(run(first), run(secondWorld));
  assert.deepEqual(first.stateForTest(), secondWorld.stateForTest());
});
