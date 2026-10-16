import assert from "node:assert/strict";
import test from "node:test";

import effectExhaust from "../../../src/effects/instructions/effect.exhaust.ts";
import {
  AwaitChoice,
  runInstruction,
  world
} from "../../../src/effects/testing/index.ts";

const expr = (value) => ({ kind: "constant", value });
const linked = (key) => ({ kind: "linked-value", instructionId: "previous", key });

const targetRun = (kernel, args, refs, options = {}) => runInstruction(effectExhaust, args, {
  world: kernel,
  targets: { selected: refs },
  ...options
});

const stateOf = (kernel, id) => {
  const object = kernel.getObject(id);
  return object === null ? null : { exhausted: object.exhausted, zone: object.zone };
};

test("exhausts a Board unit once and links the actual result (CR 415.1/415.2)", () => {
  const kernel = world().unit("u1").build();
  const result = targetRun(kernel, { target: "selected" }, [kernel.ref("u1")]);

  assert.equal(result.result?.status, "executed");
  assert.deepEqual(stateOf(kernel, "u1"), { exhausted: true, zone: "board" });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].action, "exhaust");
  assert.equal(result.linked.exhausted.count, 1);
  assert.equal(result.linked["exhausted.count"], 1);
  assert.deepEqual(result.linked["exhausted.objects"], [{ id: "u1", zoneEntryId: 1 }]);
  assert.equal(result.linked.exhausted.alreadyExhausted, 0);
});

test("an already exhausted object is not exhausted again and adds nothing (CR 415.1.b/415.1.c)", () => {
  const kernel = world().unit("u1", { exhausted: true }).build();
  const result = targetRun(kernel, { target: "selected" }, [kernel.ref("u1")]);

  assert.equal(result.result?.status, "executed");
  assert.equal(result.events.length, 0);
  assert.equal(result.linked.exhausted.count, 0);
  assert.equal(result.linked.exhausted.alreadyExhausted, 1);
  assert.deepEqual(result.linked.exhausted.objects, []);
  assert.deepEqual(stateOf(kernel, "u1"), { exhausted: true, zone: "board" });
});

test("a replacement hook replacing the Exhaust action negates the instruction", () => {
  const kernel = world().unit("u1").build();
  kernel.addReplacement((action) => (action.type === "exhaust" ? "replaced" : null));
  const result = targetRun(kernel, { target: "selected" }, [kernel.ref("u1")]);

  assert.equal(result.result?.status, "negated");
  assert.equal(result.result?.reason, "replaced");
  assert.equal(result.result.events.length, 1);
  assert.deepEqual(stateOf(kernel, "u1"), { exhausted: false, zone: "board" });
  assert.equal(result.linked.exhausted.count, 0);
});

test("prevention of one target negates the instruction while the other exhaust still stands (CR 055)", () => {
  const kernel = world().unit("u1").unit("u2").build();
  kernel.addReplacement((action) =>
    action.type === "exhaust" && action.object.id === "u2" ? "prevented" : null);
  const result = targetRun(kernel, { target: "selected" }, [kernel.ref("u1"), kernel.ref("u2")]);

  assert.equal(result.result?.status, "negated");
  assert.equal(result.result?.reason, "impossible");
  assert.deepEqual(stateOf(kernel, "u1"), { exhausted: true, zone: "board" });
  assert.deepEqual(stateOf(kernel, "u2"), { exhausted: false, zone: "board" });
  assert.equal(result.linked.exhausted.count, 1);
  assert.deepEqual(result.linked.exhausted.objects, [{ id: "u1", zoneEntryId: 1 }]);
});

test("a stale target reference is ignored after the object left its zone (CR 359.3.e.2/e.5/e.6)", () => {
  const kernel = world().unit("u1").build();
  const stale = kernel.ref("u1");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  assert.equal(kernel.object(stale), null);

  const result = targetRun(kernel, { target: "selected" }, [stale]);

  assert.deepEqual(result.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("u1").exhausted, false);
  assert.equal(result.events.length, 0);
  assert.equal(result.linked.exhausted, undefined);
});

test("an empty target set is ignored and a non-target pick is impossible instead", () => {
  const kernel = world().unit("u1").build();
  const missing = targetRun(kernel, { target: "selected" }, []);
  const stalePick = runInstruction(effectExhaust, { pick: "chosen" }, {
    world: kernel,
    picks: { chosen: [{ id: "u1", zoneEntryId: 99 }] }
  });

  assert.deepEqual(missing.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(stalePick.result?.status, "negated");
  assert.equal(stalePick.result?.reason, "impossible");
  assert.equal(kernel.getObject("u1").exhausted, false);
});

test("surviving targets are exhausted while one stale target is dropped (CR 359.3.e.8)", () => {
  const kernel = world().unit("u1").unit("u2").build();
  const stale = kernel.ref("u1");
  kernel.perform({ type: "kill", object: stale });

  const result = targetRun(kernel, { target: "selected" }, [stale, kernel.ref("u2")]);

  assert.equal(result.result?.status, "executed");
  assert.equal(result.result.linkedValues.exhausted.count, 1);
  assert.deepEqual(result.result.linkedValues["exhausted.objects"], [{ id: "u2", zoneEntryId: 1 }]);
  assert.deepEqual(stateOf(kernel, "u1"), { exhausted: false, zone: "trash" });
  assert.deepEqual(stateOf(kernel, "u2"), { exhausted: true, zone: "board" });
});

test("amount 0 executes without an action and amount above the available set caps (CR 055/355.13)", () => {
  const kernel = world().unit("u1").unit("u2").build();
  const zero = targetRun(kernel, { target: "selected", amount: expr(0) },
    [kernel.ref("u1"), kernel.ref("u2")]);
  assert.equal(zero.result?.status, "executed");
  assert.equal(zero.events.length, 0);
  assert.equal(zero.linked.exhausted.count, 0);
  assert.deepEqual(stateOf(kernel, "u1"), { exhausted: false, zone: "board" });

  const over = targetRun(kernel, { target: "selected", amount: expr(9) },
    [kernel.ref("u1"), kernel.ref("u2")]);
  assert.equal(over.result?.status, "executed");
  assert.equal(over.linked.exhausted.count, 2);
  assert.deepEqual(stateOf(kernel, "u1"), { exhausted: true, zone: "board" });
  assert.deepEqual(stateOf(kernel, "u2"), { exhausted: true, zone: "board" });
});

test("an invalid evaluated amount is impossible and performs nothing", () => {
  const kernel = world().unit("u1").build();
  for (const amount of [expr(-1), expr(1.5), expr("2")]) {
    const result = targetRun(kernel, { target: "selected", amount }, [kernel.ref("u1")]);
    assert.equal(result.result?.status, "negated", `amount ${JSON.stringify(amount)}`);
    assert.equal(result.result?.reason, "impossible");
    assert.equal(result.events.length, 0);
  }
  assert.deepEqual(stateOf(kernel, "u1"), { exhausted: false, zone: "board" });
});

test("an amount that references unavailable information is ignored, not treated as 0 (CR 359.3.e.12)", () => {
  const kernel = world().unit("u1").build();
  const result = targetRun(kernel, { target: "selected", amount: linked("missing") }, [kernel.ref("u1")]);

  assert.deepEqual(result.result, { status: "ignored", reason: "linked-ignored" });
  assert.equal(result.events.length, 0);
  assert.equal(result.linked.exhausted, undefined);
  assert.deepEqual(stateOf(kernel, "u1"), { exhausted: false, zone: "board" });
});

test("a linked amount resolves against linked values and an unusable linkKey is impossible", () => {
  const kernel = world().unit("u1").unit("u2").build();
  const result = targetRun(kernel, { target: "selected", amount: linked("budget") },
    [kernel.ref("u1"), kernel.ref("u2")], { linked: { budget: 1 } });

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.exhausted.count, 1);
  assert.deepEqual(stateOf(kernel, "u2"), { exhausted: false, zone: "board" });

  const badKey = targetRun(kernel, { target: "selected", linkKey: linked("budget") },
    [kernel.ref("u1")], { linked: { budget: 1 } });
  assert.equal(badKey.result?.status, "negated");
  assert.equal(badKey.result?.reason, "impossible");
  assert.equal(badKey.events.length, 0);
});

test("choose suspends without an answer, leaves the world untouched, and replays with the answer", () => {
  const kernel = world().unit("u2").unit("u1").build();
  const asked = runInstruction(effectExhaust, { pick: "chosen" }, {
    world: kernel,
    picks: { chosen: [kernel.ref("u2"), kernel.ref("u1")] }
  });
  assert.equal(asked.result?.status, "executed");
  assert.equal(asked.linked.exhausted.count, 2);

  const choiceKernel = world().unit("u2").unit("u1").build();
  const suspended = runInstruction(effectExhaust, { choose: { id: "exhaust-one" } }, {
    world: choiceKernel
  });
  assert.ok(suspended.asked instanceof AwaitChoice);
  assert.equal(suspended.asked.request.type, "select-objects");
  assert.equal(suspended.asked.request.id, "exhaust-one");
  assert.equal(suspended.asked.request.min, 1);
  assert.equal(suspended.asked.request.max, 1);
  assert.deepEqual(suspended.asked.request.options.map((ref) => ref.id), ["u1", "u2"]);
  assert.equal(suspended.result, null);
  assert.equal(suspended.events.length, 0);
  assert.deepEqual(stateOf(choiceKernel, "u1"), { exhausted: false, zone: "board" });
  assert.deepEqual(stateOf(choiceKernel, "u2"), { exhausted: false, zone: "board" });

  const answered = runInstruction(effectExhaust, { choose: { id: "exhaust-one" } }, {
    world: choiceKernel,
    answers: { "exhaust-one": [choiceKernel.ref("u1")] }
  });
  assert.equal(answered.asked, null);
  assert.equal(answered.result?.status, "executed");
  assert.equal(answered.linked.exhausted.count, 1);
  assert.deepEqual(stateOf(choiceKernel, "u1"), { exhausted: true, zone: "board" });
  assert.deepEqual(stateOf(choiceKernel, "u2"), { exhausted: false, zone: "board" });
});

test("choose does not ask when the choice is already determined", () => {
  const kernel = world().unit("u1", { exhausted: true }).unit("u2").build();
  const result = runInstruction(effectExhaust, { choose: { id: "exhaust-one" } }, { world: kernel });

  assert.equal(result.asked, null);
  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.exhausted.count, 1);
  assert.equal(result.linked.exhausted.alreadyExhausted, 1);
  assert.deepEqual(stateOf(kernel, "u2"), { exhausted: true, zone: "board" });
});

test("a forged choose answer is impossible and commits nothing", () => {
  const kernel = world().unit("u1").unit("u2").build();
  const result = runInstruction(effectExhaust, { choose: { id: "exhaust-one" } }, {
    world: kernel,
    answers: { "exhaust-one": [{ id: "missing", zoneEntryId: 1 }] }
  });

  assert.equal(result.result?.status, "negated");
  assert.equal(result.result?.reason, "impossible");
  assert.equal(result.events.length, 0);
  assert.deepEqual(stateOf(kernel, "u1"), { exhausted: false, zone: "board" });
  assert.deepEqual(stateOf(kernel, "u2"), { exhausted: false, zone: "board" });
});

test("only Board non-spell game objects can be exhausted (CR 415.1)", () => {
  const kernel = world()
    .unit("u1")
    .hand("spell", { types: ["spell"] })
    .object("chain-item", { types: ["spell"], zone: "chain" })
    .build();
  const spell = targetRun(kernel, { target: "selected" }, [kernel.ref("spell")]);
  const chainItem = targetRun(kernel, { target: "selected" }, [kernel.ref("chain-item")]);

  assert.deepEqual(spell.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(chainItem.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("spell").exhausted, false);
});

test("amount and linkKey read linked values, and the receipt is linkable for 'if you do'", () => {
  const kernel = world().unit("u1").unit("u2").unit("u3").build();
  const result = targetRun(kernel, { target: "selected", amount: linked("remaining"), linkKey: expr("spent") }, [
    kernel.ref("u1"), kernel.ref("u2"), kernel.ref("u3")
  ], { linked: { remaining: 2 } });

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.spent.count, 2);
  assert.equal(result.linked["spent.count"], 2);
  assert.equal(result.linked.exhausted, undefined);
  assert.equal(kernel.linked("spent.count"), 2);
  assert.equal(kernel.getObject("u3").exhausted, false);
});

test("sfd-205-221 Grand Duelist: 'you may exhaust me to channel 1 rune exhausted'", () => {
  const kernel = world()
    .unit("legend", { types: ["legend"], location: { type: "base", player: "A" } })
    .unit("unit")
    .build();
  // 可选从句在作者侧包一层 choice.optional；这里固定被选中的一半语义：
  // "exhaust me" 把 Legend 自己（能力来源）横置，并把实际结果写进链接值。
  const result = targetRun(kernel, { target: "selected" }, [kernel.ref("legend")]);

  assert.equal(result.result?.status, "executed");
  assert.deepEqual(stateOf(kernel, "legend"), { exhausted: true, zone: "board" });
  assert.equal(result.linked.exhausted.count, 1);
  assert.deepEqual(result.linked.exhausted.objects, [{ id: "legend", zoneEntryId: 1 }]);
});

test("sfd-203-221 Battle Mistress: 'you may exhaust me to play a Gold gear token exhausted'", () => {
  const kernel = world()
    .object("mistress", { types: ["legend"], name: "Battle Mistress", zone: "board" })
    .build();
  const mistress = kernel.ref("mistress");
  // "exhaust me" 横置能力来源本身；"play a Gold gear token exhausted" 是另一个原语的
  // 入场状态（CR 184.1/185.2.d），本原语只负责前者，二者不能互相替代。
  const result = targetRun(kernel, { target: "selected" }, [mistress]);

  assert.equal(result.result?.status, "executed");
  assert.deepEqual(stateOf(kernel, "mistress"), { exhausted: true, zone: "board" });
  assert.equal(result.linked.exhausted.count, 1);
  // already exhausted 时这句可选文本的"付出"其实没有发生（415.1.b/c），
  // 链接值让 "if you do" 能看出来。
  const again = targetRun(kernel, { target: "selected" }, [kernel.ref("mistress")]);
  assert.equal(again.result?.status, "executed");
  assert.equal(again.linked.exhausted.count, 0);
  assert.equal(again.linked.exhausted.alreadyExhausted, 1);
});

test("rad-029-167 Life from Stone: the additional cost needs cost.exhaust, not this effect path (CR 415.4)", () => {
  const kernel = world().unit("friendly").build();
  // "As an additional cost to play this, exhaust a friendly unit."（415.4）要求费用必须
  // 能完成才能支付：已横置的友方单位不能再作为该费用被横置。费用侧由 cost.exhaust
  // 判定；本原语作为效果执行时对已横置对象只是"不再发生任何额外事情"（415.1.c），
  // 因此这里故意不把 count=0 报成错误，也绝不冒充费用已支付。
  const paid = runInstruction(effectExhaust, { pick: "cost-unit" }, {
    world: kernel,
    picks: { "cost-unit": [kernel.ref("friendly")] }
  });
  assert.equal(paid.result?.status, "executed");
  assert.equal(paid.linked.exhausted.count, 1);

  const alreadySpent = runInstruction(effectExhaust, { pick: "cost-unit" }, {
    world: kernel,
    picks: { "cost-unit": [kernel.ref("friendly")] }
  });
  assert.equal(alreadySpent.result?.status, "executed");
  assert.equal(alreadySpent.linked.exhausted.count, 0);
  assert.equal(alreadySpent.events.length, 0);
  assert.deepEqual(stateOf(kernel, "friendly"), { exhausted: true, zone: "board" });
  // 本原语不提供任何费用式入参，费用语义无法经 args 混入。
  assert.throws(() => effectExhaust.argsSchema.parse({ pick: "cost-unit", asAdditionalCost: true }));
});

test("sfd-070-221 Wages of Pain: 'Play a Gold gear token exhausted' is an entry state, not an exhaust effect", () => {
  const kernel = world().build();
  // 该 token 尚不存在；"exhausted" 是 create-token 的入场规定（CR 143.4/184.1），
  // 因此在没有任何可横置对象时本原语必须什么都不做。
  const result = runInstruction(effectExhaust, { choose: { id: "gold-token" } }, { world: kernel });

  assert.equal(result.asked, null);
  assert.equal(result.result?.status, "negated");
  assert.equal(result.result?.reason, "impossible");
  assert.equal(result.events.length, 0);
});

test("unl-175-219 Tactical Retreat: the replacement body 'heal it, exhaust it, and recall it'", () => {
  const kernel = world().unit("friendly", { damage: 2 }).build();
  // 替代效果的主体把被选中单位横置；横置本身只改横置状态，召回/治疗属于其他原语。
  const result = runInstruction(effectExhaust, { pick: "chosen" }, {
    world: kernel,
    picks: { chosen: [kernel.ref("friendly")] }
  });

  assert.equal(result.result?.status, "executed");
  assert.deepEqual(stateOf(kernel, "friendly"), { exhausted: true, zone: "board" });
  assert.equal(kernel.getObject("friendly").damage, 2);
  assert.equal(result.linked.exhausted.count, 1);
});

test("sfd-069-221 Plundering Poro / sfd-220-221 Treasure Hoard: entering exhausted is not an exhaust action", () => {
  const kernel = world().object("gold", { types: ["gear"], zone: "chain" }).build();
  // "play a Gold gear token exhausted" 是入场状态（CR 184.1/185.2.d），由 create-token
  // 表达；对一个尚未在 Board 的 token 补一次横置既不是该文本的语义，也没有可用动作。
  const result = targetRun(kernel, { target: "selected" }, [kernel.ref("gold")]);

  assert.deepEqual(result.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(result.events.length, 0);
  assert.equal(kernel.getObject("gold").exhausted, false);
});

test("sfd-019-221 Assembly Rig: the [E] activation cost is not this effect path", () => {
  const kernel = world().hand("rig", { types: ["gear"] }).build();
  // ":rb_exhaust:" 是激活费用（CR 415.3.a/415.4/415.5），属于 cost.exhaust 与 finalized
  // 费用计划：手牌里的 Gear 不是 415.1 的横置对象，本原语不能用来支付该费用。
  const inHand = targetRun(kernel, { target: "selected" }, [kernel.ref("rig")]);
  assert.deepEqual(inHand.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("rig").exhausted, false);

  // 本原语没有费用式接口：费用语义不能经 args 混入。
  assert.throws(() => effectExhaust.argsSchema.parse({ target: "selected", asCost: true }));
  assert.throws(() => effectExhaust.argsSchema.parse({ target: "selected", pay: expr(1) }));
});

test("effect.exhaust rejects malformed arguments and accepts every card-dsl expression form", () => {
  assert.throws(() => effectExhaust.argsSchema.parse({}));
  assert.throws(() => effectExhaust.argsSchema.parse({ target: "selected", pick: "chosen" }));
  assert.throws(() => effectExhaust.argsSchema.parse({ target: 7 }));
  assert.throws(() => effectExhaust.argsSchema.parse({ target: "selected", amount: 2 }));
  assert.throws(() => effectExhaust.argsSchema.parse({ target: "selected", extra: expr(1) }));
  assert.throws(() => effectExhaust.argsSchema.parse({ choose: { id: "" } }));
  assert.throws(() => effectExhaust.argsSchema.parse({ choose: { id: "c", visibility: "secret" } }));
  assert.throws(() => effectExhaust.argsSchema.parse({ choose: { id: "c", filter: 3 } }));

  const forms = [
    expr(1),
    { kind: "literal", value: 1 },
    { kind: "object-property", object: { id: "u1", zoneEntryId: 1 }, property: "buffs" },
    { kind: "object-attribute", object: { id: "u1", zoneEntryId: 1 }, attribute: "buff" },
    { kind: "linked", instructionId: "previous", key: "remaining" },
    { kind: "linked-value", instructionId: "previous", key: "remaining" },
    { kind: "count", subject: "units", filter: { zone: "board" } }
  ];
  for (const amount of forms) {
    const parsed = effectExhaust.argsSchema.parse({ target: "selected", amount });
    assert.equal(parsed.amount, amount);
  }
  const parsedChoice = effectExhaust.argsSchema.parse({
    choose: { id: "exhaust-one", filter: { zone: "board" }, chooser: "A", visibility: "public", prompt: "Exhaust" }
  });
  assert.equal(parsedChoice.choose.id, "exhaust-one");
});
