import assert from "node:assert/strict";
import test from "node:test";

import effectMill from "../../../src/effects/instructions/effect.mill.ts";
import { AwaitChoice, runInstruction, world } from "../../../src/effects/testing/index.ts";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../dist/effects/instructions/registry.generated.js";

const literal = value => ({ kind: "literal", value });
const refValue = ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId });

const deckIds = (kernel, player = "A") =>
  kernel.zoneSlice(player, "deck", "top").map(object => object.ref.id);
const trashIds = (kernel, player = "A") =>
  kernel.zoneSlice(player, "trash", "top").map(object => object.ref.id);

test("burns the real top N of the Main Deck into its owner's Trash in top-to-bottom order", () => {
  // id 字典序与真实牌序故意相反：若实现退回 query + 按 id 排序，会误烧 z-under 并打乱顺序。
  const kernel = world().deck(["a-top", "m-second", "z-under", "rest"]).build();
  const run = runInstruction(effectMill, { amount: literal(2) }, { world: kernel });

  assert.equal(effectMill.op, "effect.mill");
  assert.equal(run.result?.status, "executed");
  assert.deepEqual(trashIds(kernel), ["a-top", "m-second"]);
  assert.deepEqual(deckIds(kernel), ["z-under", "rest"]);
  assert.equal(run.linked.burnedCount, 2);
  assert.equal(run.linked.burnedPlayer, "A");
  assert.deepEqual(run.linked.burned.map(ref => ref.id), ["a-top", "m-second"]);
  assert.equal(run.linked.burnedCard.id, "a-top");
  assert.deepEqual(run.events.map(event => event.action), ["mill"]);
  assert.equal(kernel.history({ action: "mill", player: "A" }), 1);
});

test("ven-144-166 Death Mark: [Burn 3] burns the top 3 and leaves the rest of the deck in order", () => {
  // "[Burn 3]. (Put the top 3 cards of your Main Deck into your trash.) Play a 0 [M] Shadow Clone..."
  // 本原语负责 Burn 3 那一段；后续 token 由 effect.token 处理。
  const kernel = world().deck(["one", "two", "three", "four"]).build();
  const run = runInstruction(effectMill, { amount: literal(3) }, { world: kernel });

  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.burnedCount, 3);
  assert.deepEqual(trashIds(kernel), ["one", "two", "three"]);
  assert.deepEqual(deckIds(kernel), ["four"]);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("ven-108-166 Forgotten Relic: [Burn 1] links the burned card for the follow-up characteristic read", () => {
  // "When you play this or at the start of your Beginning Phase, [Burn 1]. When you burn a unit
  //  this way, do this: Give a friendly unit +[M] equal to the burned card's Might this turn."
  // 124：被烧的牌成为新对象；"the burned card's Might" 只能经 359.3.e.13 回看最后已知信息。
  const kernel = world().deck(["burned-unit", "under"], { types: ["unit"], might: 4 }).build();
  const topRef = kernel.zoneSlice("A", "deck", "top", 1)[0].ref;
  const run = runInstruction(effectMill, { amount: literal(1) }, { world: kernel });

  assert.equal(run.result?.status, "executed");
  assert.deepEqual(run.linked.burnedCard, refValue(topRef));
  assert.equal(kernel.object(topRef), null, "the burned card's old reference is invalid after burning");
  assert.equal(kernel.lastKnown(topRef).might, 4);
  assert.equal(kernel.lastKnown(topRef).name, "burned-unit");
});

test("ven-114-166 Kharox: 'choose an opponent. They [Burn 3]' suspends and replays with the chosen opponent", () => {
  // "When I become [Empowered], choose an opponent. They [Burn 3]." 候选烧牌者多于一个时经
  // ctx.choose 挂起（重放式），答案决定由谁的主牌库被烧。
  const kernel = world()
    .deck(["a-top", "a-under"])
    .deck(["b-top", "b-under", "b-last"], { owner: "B" })
    .build();
  const args = {
    amount: literal(3),
    player: literal(["A", "B"]),
    choice: { id: "kharox-opponent", prompt: "Choose an opponent to burn 3." }
  };

  const asked = runInstruction(effectMill, args, { world: kernel });
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.type, "mode");
  assert.equal(asked.asked.request.chooser, "A");
  assert.equal(asked.asked.request.visibility, "public");
  assert.deepEqual(asked.asked.request.options, ["A", "B"]);
  // 挂起时世界未被修改（事务回滚）。
  assert.deepEqual(deckIds(kernel, "A"), ["a-top", "a-under"]);
  assert.deepEqual(deckIds(kernel, "B"), ["b-top", "b-under", "b-last"]);
  assert.equal(kernel.events.length, 0);

  const answered = runInstruction(effectMill, args, {
    world: kernel,
    answers: { "kharox-opponent": "B" }
  });
  assert.equal(answered.result?.status, "executed");
  assert.equal(answered.linked.burnedPlayer, "B");
  assert.equal(answered.linked.burnedCount, 3);
  assert.deepEqual(trashIds(kernel, "B"), ["b-top", "b-under", "b-last"]);
  assert.deepEqual(deckIds(kernel, "A"), ["a-top", "a-under"], "A's deck was left alone");
});

test("Burn 0 performs no game action but still resolves as executed and links zero", () => {
  const kernel = world().deck("kept").build();
  const run = runInstruction(effectMill, { amount: literal(0) }, { world: kernel });

  assert.equal(run.result?.status, "executed");
  assert.equal(run.events.length, 0);
  assert.equal(run.linked.burnedCount, 0);
  assert.deepEqual(run.linked.burned, []);
  assert.equal(run.linked.burnedCard, null);
  assert.equal(run.linked.burnedPlayer, "A");
  assert.deepEqual(deckIds(kernel), ["kept"]);
});

test("441.4: burning more than the deck burns as many as possible and is not a failure", () => {
  const kernel = world().deck(["one", "two"]).build();
  const run = runInstruction(effectMill, { amount: literal(9) }, { world: kernel });

  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.burnedCount, 2);
  assert.deepEqual(trashIds(kernel), ["one", "two"]);
  assert.deepEqual(deckIds(kernel), []);
});

test("burning an empty Main Deck resolves as executed with zero actual burns", () => {
  const kernel = world().build();
  const run = runInstruction(effectMill, { amount: literal(2) }, { world: kernel });

  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.burnedCount, 0);
  assert.deepEqual(run.linked.burned, []);
  assert.equal(run.linked.burnedCard, null);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("a negative or non-integer amount negates the instruction as impossible", () => {
  const kernel = world().deck("kept").build();

  const negative = runInstruction(effectMill, { amount: literal(-1) }, { world: kernel });
  assert.equal(negative.result?.status, "negated");
  assert.equal(negative.result?.reason, "impossible");

  const fractional = runInstruction(effectMill, { amount: literal(1.5) }, { world: kernel });
  assert.equal(fractional.result?.status, "negated");
  assert.equal(fractional.result?.reason, "impossible");

  assert.deepEqual(deckIds(kernel), ["kept"], "no card left the deck");
  assert.equal(kernel.events.length, 0);
});

test("an unknown burning player is negated as impossible instead of throwing", () => {
  const kernel = world().deck("a-card").build();
  const run = runInstruction(effectMill, { amount: literal(1), player: literal("Z") }, { world: kernel });

  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "impossible");
  assert.deepEqual(deckIds(kernel), ["a-card"]);
});

test("a replacement hook on the mill action negates the instruction", () => {
  const kernel = world().deck(["neg-a", "neg-b"]).build();
  kernel.addReplacement(action => (action.type === "mill" ? "replaced" : null));
  const run = runInstruction(effectMill, { amount: literal(2) }, { world: kernel });

  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "replaced");
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].outcome, "replaced");
  assert.deepEqual(deckIds(kernel), ["neg-a", "neg-b"]);
  assert.deepEqual(trashIds(kernel), []);
  assert.deepEqual(run.linked, {});
});

test("a prevented mill negates the instruction with reason skipped", () => {
  const kernel = world().deck(["stop-a", "stop-b"]).build();
  kernel.addReplacement(action => (action.type === "mill" ? "prevented" : null));
  const run = runInstruction(effectMill, { amount: literal(1) }, { world: kernel });

  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "skipped");
  assert.deepEqual(deckIds(kernel), ["stop-a", "stop-b"]);
});

test("all target references stale after the object left its zone is ignored (mistargeted)", () => {
  // 359.3.e.7：目标全部失效 → 本指令不执行，且不产生任何烧牌动作。
  const kernel = world().unit("watcher").deck("top").build();
  const stale = kernel.ref("watcher");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  assert.equal(kernel.object(stale), null);
  const run = runInstruction(effectMill, { amount: literal(1), target: literal("chosen") }, {
    world: kernel,
    targets: { chosen: [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(deckIds(kernel), ["top"]);
  assert.equal(run.events.length, 0, "the ignored instruction produced no event");
});

test("a live target burns its controller's deck and 359.3.e.8 keeps partial target groups working", () => {
  // "its controller burns N"：由仍合法目标的控制者烧牌。部分目标失效时只用仍合法的目标。
  const kernel = world()
    .unit("a-unit", { owner: "A" })
    .unit("b-unit", { owner: "B" })
    .deck(["b-top", "b-under"], { owner: "B" })
    .deck(["a-top"])
    .build();
  const live = kernel.ref("b-unit");
  const gone = kernel.ref("a-unit");
  kernel.perform({ type: "move-zone", object: gone, to: "trash" });
  const run = runInstruction(effectMill, { amount: literal(2), target: literal("chosen") }, {
    world: kernel,
    targets: { chosen: [gone, live] }
  });

  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.burnedPlayer, "B");
  assert.deepEqual(trashIds(kernel, "B"), ["b-top", "b-under"]);
  assert.deepEqual(deckIds(kernel, "A"), ["a-top"], "A's deck was left alone");
});

test("a pick resolves non-target candidates, including ObjectRef entries that name the burning player", () => {
  // kickoff pick 不是目标（355.10.c/e/f）：条目可以是 PlayerId，也可以是对象（取其控制者）。
  const kernel = world()
    .deck(["a-top"])
    .deck(["b-top", "b-under"], { owner: "B" })
    .build();
  const run = runInstruction(effectMill, { amount: literal(2), pick: literal("miller") }, {
    world: kernel,
    picks: { miller: [kernel.ref("b-top")] }
  });

  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.burnedPlayer, "B");
  assert.deepEqual(trashIds(kernel, "B"), ["b-top", "b-under"]);
  assert.deepEqual(deckIds(kernel, "A"), ["a-top"]);
});

test("multiple candidate millers without a choice config are impossible rather than ambiguous", () => {
  const kernel = world().deck(["a-top"]).deck(["b-top"], { owner: "B" }).build();
  const run = runInstruction(effectMill, { amount: literal(1), player: literal(["A", "B"]) }, { world: kernel });

  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "impossible");
  assert.deepEqual(deckIds(kernel, "A"), ["a-top"]);
  assert.deepEqual(deckIds(kernel, "B"), ["b-top"]);
});

test("argsSchema rejects malformed argument shapes", () => {
  assert.throws(() => effectMill.argsSchema.parse(null), /args must be an object/);
  assert.throws(() => effectMill.argsSchema.parse({}), /amount must be an Expr/);
  assert.throws(() => effectMill.argsSchema.parse({ amount: literal(1), nope: 1 }), /Invalid effect.mill argument/);
  assert.throws(
    () => effectMill.argsSchema.parse({ amount: literal(1), target: "a", pick: "b" }),
    /only one of target, pick, or player/
  );
  assert.throws(
    () => effectMill.argsSchema.parse({ amount: literal(1), choice: { id: "" } }),
    /choice.id must be a non-empty string/
  );
  assert.throws(
    () => effectMill.argsSchema.parse({ amount: literal(1), player: [] }),
    /must not be an empty candidate list/
  );
});

test("schema parse keeps Expr amounts untouched for resolution-time evaluation", () => {
  const parsed = effectMill.argsSchema.parse({ amount: literal(3), player: literal("B") });
  assert.deepEqual(parsed, { amount: literal(3), player: literal("B") });
  assert.equal(effectMill.argsSchema.safeParse({ amount: "3" }).success, false);
  assert.equal(effectMill.argsSchema.safeParse({ amount: 3 }).success, true);
});

/** Run a card-program body through the real interpreter with the generated registry. */
function runBody(body, kernel, answers = {}) {
  let outcome = null;
  const wrapper = {
    op: "test.mill-body",
    argsSchema: { parse: value => value },
    execute(context) {
      outcome = runAbilityBody(body, context, instructionDefinitionsById);
      return { status: "executed", events: [...outcome.events] };
    }
  };
  return { ...runInstruction(wrapper, {}, { world: kernel, answers }), outcome };
}

test("an authored EffectIR body burns via the interpreter, which hands the primitive evaluated arguments", () => {
  // 解释器在调用原语前会先把 args 求值（interpreter.ts dispatch），因此 amount 到达原语时
  // 是数字 2 而不是 Expr；链接值随后可供 "that card" / "if you do" 类指令读取。
  const kernel = world().deck(["one", "two", "rest"]).build();
  const run = runBody([
    { id: "burn", op: "effect.mill", args: { amount: literal(2) } },
    {
      id: "count",
      op: "condition.value",
      args: { value: { kind: "linked-value", instructionId: "burn", key: "burnedCount" } }
    }
  ], kernel);

  assert.equal(run.result?.status, "executed");
  assert.equal(run.outcome?.status, "executed");
  assert.deepEqual(trashIds(kernel), ["one", "two"]);
  assert.deepEqual(deckIds(kernel), ["rest"]);
  const burned = run.outcome.results.find(result => result.id === "burn").result;
  assert.equal(burned.linkedValues.burnedCount, 2);
  assert.deepEqual(burned.linkedValues.burned.map(ref => ref.id), ["one", "two"]);
  assert.equal(run.outcome.linkedValues["count.value"], 2);
});

test("the Kharox opponent choice suspends and replays through the interpreter with path-scoped answers", () => {
  const kernel = world()
    .deck(["a-top"])
    .deck(["b-top", "b-under", "b-last"], { owner: "B" })
    .build();
  const body = [{
    id: "burn",
    op: "effect.mill",
    args: {
      amount: literal(3),
      player: literal(["A", "B"]),
      choice: { kind: "constant", value: { id: "kharox-opponent", prompt: "Choose an opponent." } }
    }
  }];

  const asked = runBody(body, kernel);
  assert.ok(asked.asked instanceof AwaitChoice);
  assert.equal(asked.asked.request.id, "burn/kharox-opponent");
  assert.equal(asked.asked.request.type, "mode");
  assert.deepEqual(asked.asked.request.options, ["A", "B"]);
  assert.equal(kernel.events.length, 0, "the world rolled back while awaiting the answer");

  const answered = runBody(body, kernel, { "burn/kharox-opponent": "B" });
  assert.equal(answered.result?.status, "executed");
  assert.deepEqual(trashIds(kernel, "B"), ["b-top", "b-under", "b-last"]);
  assert.deepEqual(deckIds(kernel, "A"), ["a-top"]);
});
