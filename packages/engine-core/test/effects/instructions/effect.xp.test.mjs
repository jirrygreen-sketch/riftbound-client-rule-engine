import assert from "node:assert/strict";
import test from "node:test";

import effectXp from "../../../src/effects/instructions/effect.xp.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";

const literal = value => ({ kind: "constant", value });
const zero = literal(0);
const one = literal(1);
const two = literal(2);
const three = literal(3);
const linked = key => ({ kind: "linked-value", instructionId: "previous", key });

test("effect.xp gains XP for the controller and links the actual amount (CR 728-730.1)", () => {
  const kernel = world().build();
  const run = runInstruction(effectXp, { amount: three }, { world: kernel });

  assert.equal(effectXp.op, "effect.xp");
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").xp, 3);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(run.linked.gained, 3);
  assert.equal(run.linked.gainedTo, "A");
  assert.deepEqual(run.result.linkedValues, { gainedTo: "A", gained: 3 });
  assert.deepEqual(run.events.map(event => event.action), ["gain-xp"]);
  assert.equal(kernel.history({ action: "gain-xp", player: "A" }), 1);
});

test("effect.xp with amount 0 performs no action and still executes with 0 (CR 730.1/733)", () => {
  const kernel = world().build();
  const run = runInstruction(effectXp, { amount: zero }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.events.length, 0);
  assert.equal(kernel.player("A").xp, 0);
  assert.equal(run.linked.gained, 0);
  assert.equal(run.linked.gainedTo, "A");
});

test("effect.xp links a custom key and never shadows the reserved gainedTo key", () => {
  const kernel = world().build();
  const run = runInstruction(effectXp, { amount: two, linkKey: "hunted" }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.hunted, 2);
  assert.equal(run.linked.gainedTo, "A");
  assert.equal(run.linked.gained, undefined);
  assert.throws(() => effectXp.argsSchema.parse({ amount: one, linkKey: "gainedTo" }), /gainedTo/);
});

test("effect.xp is negated with reason replaced when the gain-xp action is replaced", () => {
  const kernel = world().build();
  kernel.addReplacement(action => (action.type === "gain-xp" ? "replaced" : null));
  const run = runInstruction(effectXp, { amount: two }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(kernel.player("A").xp, 0);
  assert.deepEqual(run.linked, {});
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].action, "gain-xp");
  assert.equal(run.events[0].outcome, "replaced");
});

test("effect.xp maps a prevented gain to negated/skipped and an impossible gain to negated/impossible", () => {
  const prevented = world().build();
  prevented.addReplacement(action => (action.type === "gain-xp" ? "prevented" : null));
  const preventedRun = runInstruction(effectXp, { amount: one }, { world: prevented });
  assert.equal(preventedRun.result.status, "negated");
  assert.equal(preventedRun.result.reason, "skipped");
  assert.equal(prevented.player("A").xp, 0);

  const impossible = world().build();
  impossible.addReplacement(action => (action.type === "gain-xp" ? "impossible" : null));
  const impossibleRun = runInstruction(effectXp, { amount: one }, { world: impossible });
  assert.equal(impossibleRun.result.status, "negated");
  assert.equal(impossibleRun.result.reason, "impossible");
  assert.equal(impossible.player("A").xp, 0);
});

test("effect.xp ignores a target whose object left its zone (old zoneEntryId)", () => {
  const kernel = world().unit("vanishing").build();
  const stale = kernel.ref("vanishing");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const before = kernel.stateForTest();

  const run = runInstruction(effectXp, { target: "chosen", amount: one }, {
    world: kernel,
    targets: { chosen: [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(kernel.stateForTest(), before);
  assert.deepEqual(run.linked, {});
});

test("effect.xp keeps the legal targets when only part of the target group is stale", () => {
  const kernel = world().unit("survivor").unit("leaver").build();
  const stale = kernel.ref("leaver");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");

  const run = runInstruction(effectXp, { target: "chosen", amount: two }, {
    world: kernel,
    targets: { chosen: [stale, kernel.ref("survivor")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.gainedTo, "A");
  assert.equal(run.linked.gained, 2);
  assert.equal(kernel.player("A").xp, 2);
});

test("effect.xp anchors on a target's controller and reads a pick as a non-target selection", () => {
  const targeted = world().unit("enemy-gear", { owner: "B", types: ["gear"] }).build();
  const targetRun = runInstruction(effectXp, { target: "chosen", amount: one }, {
    world: targeted,
    targets: { chosen: [targeted.ref("enemy-gear")] }
  });
  assert.equal(targetRun.result.status, "executed");
  assert.equal(targetRun.linked.gainedTo, "B");
  assert.equal(targeted.player("B").xp, 1);
  assert.equal(targeted.player("A").xp, 0);

  // Pick 不是目标：已离区的对象用最后已知信息回看其控制者（CR 355.7/359.3.e.13）。
  const picked = world().unit("enemy-gear", { owner: "B", types: ["gear"] }).build();
  const ref = picked.ref("enemy-gear");
  assert.equal(picked.perform({ type: "kill", object: ref }).status, "done");
  const pickRun = runInstruction(effectXp, { pick: "recipient", amount: two }, {
    world: picked,
    picks: { recipient: [ref] }
  });
  assert.equal(pickRun.result.status, "executed");
  assert.equal(pickRun.linked.gainedTo, "B");
  assert.equal(picked.player("B").xp, 2);
});

test("effect.xp asks for the gaining player when the target group spans controllers", () => {
  const kernel = world()
    .unit("ally")
    .unit("enemy", { owner: "B" })
    .build();
  const args = {
    target: "chosen",
    amount: one,
    choice: { id: "gaining-player", prompt: "Choose the player who gains XP" }
  };
  const targets = { chosen: [kernel.ref("ally"), kernel.ref("enemy")] };

  const asked = runInstruction(effectXp, args, { world: kernel, targets });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.id, "gaining-player");
  assert.equal(asked.asked.request.type, "mode");
  assert.equal(asked.asked.request.chooser, "A");
  assert.equal(asked.asked.request.visibility, "public");
  assert.deepEqual(asked.asked.request.options, ["A", "B"]);
  assert.equal(asked.result, null);
  assert.equal(kernel.player("A").xp, 0);
  assert.equal(kernel.player("B").xp, 0);

  const answered = runInstruction(effectXp, args, {
    world: kernel,
    targets,
    answers: { "gaining-player": "B" }
  });
  assert.equal(answered.asked, null);
  assert.equal(answered.result.status, "executed");
  assert.equal(answered.linked.gainedTo, "B");
  assert.equal(answered.linked.gained, 1);
  assert.equal(kernel.player("A").xp, 0);
  assert.equal(kernel.player("B").xp, 1);
});

test("effect.xp negates an out-of-range choice answer instead of gaining XP", () => {
  const kernel = world().unit("ally").unit("enemy", { owner: "B" }).build();
  const run = runInstruction(effectXp, {
    target: "chosen",
    amount: one,
    choice: { id: "gaining-player" }
  }, {
    world: kernel,
    targets: { chosen: [kernel.ref("ally"), kernel.ref("enemy")] },
    answers: { "gaining-player": "C" }
  });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.events.length, 0);
  assert.equal(kernel.player("A").xp, 0);
  assert.equal(kernel.player("B").xp, 0);
});

test("effect.xp negates a multi-controller target group without an explicit choice", () => {
  const kernel = world().unit("ally").unit("enemy", { owner: "B" }).build();
  const run = runInstruction(effectXp, { target: "chosen", amount: one }, {
    world: kernel,
    targets: { chosen: [kernel.ref("ally"), kernel.ref("enemy")] }
  });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.player("A").xp, 0);
  assert.equal(kernel.player("B").xp, 0);
});

test("effect.xp accepts every expression form for amount and evaluates them at resolution time", () => {
  const forms = [
    literal(2),
    { kind: "literal", value: 2 },
    { kind: "linked", instructionId: "previous", key: "budget" },
    { kind: "linked-value", instructionId: "previous", key: "budget" },
    { kind: "count", subject: "friendly-units", filter: { zone: "board", controller: "A" } },
    {
      kind: "arithmetic",
      operator: "add",
      operands: [{ kind: "constant", value: 1 }, { kind: "constant", value: 2 }]
    }
  ];
  for (const amount of forms) {
    const parsed = effectXp.argsSchema.parse({ amount });
    assert.equal(parsed.amount, amount);
  }

  const kernel = world().build();
  const linkedRun = runInstruction(effectXp, { amount: linked("budget") }, {
    world: kernel,
    linked: { budget: 2 }
  });
  assert.equal(linkedRun.result.status, "executed");
  assert.equal(linkedRun.linked.gained, 2);
  assert.equal(kernel.player("A").xp, 2);

  const countKernel = world().unit("u1").unit("u2", { owner: "B" }).build();
  const countRun = runInstruction(effectXp, {
    amount: { kind: "count", subject: "units", filter: { zone: "board", controller: "A" } }
  }, { world: countKernel });
  assert.equal(countRun.result.status, "executed");
  assert.equal(countRun.linked.gained, 1);
  assert.equal(countKernel.player("A").xp, 1);
});

test("effect.xp negates invalid amounts and unknown players without any XP change", () => {
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  for (const amount of [literal(-1), literal(1.5), literal("two"), literal(null), literal(true), literal(unsafe)]) {
    const kernel = world().build();
    const run = runInstruction(effectXp, { amount }, { world: kernel });
    assert.equal(run.result.status, "negated", "amount " + JSON.stringify(amount));
    assert.equal(run.result.reason, "impossible");
    assert.equal(run.events.length, 0);
    assert.equal(kernel.player("A").xp, 0);
  }

  const unknown = world().build();
  const unknownRun = runInstruction(effectXp, { player: literal("C"), amount: one }, { world: unknown });
  assert.equal(unknownRun.result.status, "negated");
  assert.equal(unknownRun.result.reason, "impossible");
  assert.equal(unknown.player("A").xp, 0);
  assert.equal(unknown.player("B").xp, 0);
});

test("effect.xp negates an unavailable linked amount instead of treating null as 0", () => {
  const kernel = world().build();
  const run = runInstruction(effectXp, { amount: linked("missing") }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.events.length, 0);
  assert.equal(kernel.player("A").xp, 0);
  assert.deepEqual(run.linked, {});
});

test("effect.xp has no accrual cap (CR 733) and accepts an explicit player Expr", () => {
  const huge = world().build();
  const hugeRun = runInstruction(effectXp, { amount: literal(Number.MAX_SAFE_INTEGER) }, { world: huge });
  assert.equal(hugeRun.result.status, "executed");
  assert.equal(huge.player("A").xp, Number.MAX_SAFE_INTEGER);

  const exprKernel = world().build();
  const exprRun = runInstruction(effectXp, { player: literal("B"), amount: two }, { world: exprKernel });
  assert.equal(exprRun.result.status, "executed");
  assert.equal(exprRun.linked.gainedTo, "B");
  assert.equal(exprKernel.player("B").xp, 2);
  assert.equal(exprKernel.player("A").xp, 0);

  const staticKernel = world().build();
  const staticRun = runInstruction(effectXp, { player: "B", amount: one }, { world: staticKernel });
  assert.equal(staticRun.result.status, "executed");
  assert.equal(staticRun.linked.gainedTo, "B");
  assert.equal(staticKernel.player("B").xp, 1);
  assert.equal(staticKernel.player("A").xp, 0);
});

test("effect.xp argsSchema rejects malformed arguments", () => {
  assert.throws(() => effectXp.argsSchema.parse({}), /amount/);
  assert.throws(() => effectXp.argsSchema.parse({ amount: 2 }), /amount/);
  assert.throws(() => effectXp.argsSchema.parse({ amount: one, player: 7 }), /player/);
  assert.throws(() => effectXp.argsSchema.parse({ amount: one, target: "a", pick: "b" }), /only one of target, pick, or player/);
  assert.throws(() => effectXp.argsSchema.parse({ amount: one, extra: literal(1) }), /Invalid effect.xp argument: extra/);
  assert.throws(() => effectXp.argsSchema.parse({ amount: one, choice: { id: "" } }), /choice.id/);
  assert.throws(() => effectXp.argsSchema.parse({ amount: one, choice: { id: "c", visibility: "secret" } }), /visibility/);
  assert.throws(() => effectXp.argsSchema.parse({ amount: one, choice: { id: "c", chooser: "A" } }), /chooser/);
  assert.throws(() => effectXp.argsSchema.parse({ amount: one, linkKey: "" }), /linkKey/);
});

test("unl-117-219 Arachnoid Horror: [Hunt 2] my controller gains 2 XP (CR 823.1.c.1)", () => {
  const kernel = world().unit("arachnoid-horror", { owner: "A", zone: "board" }).build();
  const run = runInstruction(effectXp, { amount: two }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.gained, 2);
  assert.equal(run.linked.gainedTo, "A");
  assert.equal(kernel.player("A").xp, 2);
  assert.equal(kernel.player("B").xp, 0);
});

test("unl-136-219 Scryer's Bloom: Kill this, [1], [E]: [Predict 2], then draw 1. Gain 1 XP", () => {
  const kernel = world().object("scryers-bloom", { types: ["gear"], zone: "board" }).build();
  const run = runInstruction(effectXp, { amount: one }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.gained, 1);
  assert.equal(kernel.player("A").xp, 1);
  // 本条文本的 Kill this / [Predict 2] / draw 1 属于其他原语；本原语只结算最后一句。
  assert.equal(kernel.getObject("scryers-bloom").zone, "board");
});

test("unl-157-219 Scrutinizing Sergeant: gain 1 XP for each friendly unit", () => {
  const kernel = world()
    .unit("sergeant", { owner: "A", zone: "board" })
    .unit("friendly-one", { owner: "A", zone: "board" })
    .unit("enemy-one", { owner: "B", zone: "board" })
    .build();
  const run = runInstruction(effectXp, {
    amount: { kind: "count", subject: "friendly-units", filter: { zone: "board", controller: "A" } }
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.gained, 2);
  assert.equal(kernel.player("A").xp, 2);
  assert.equal(kernel.player("B").xp, 0);
});

