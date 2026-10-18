import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/dr-mundo-expert.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const [staticAbility, triggered] = program.abilities;
const c = value => ({ kind: "constant", value });
const forged = { ...program, status: "executable", judgeReason: undefined };

const trashCard = (id, extra = {}) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: `card:${id}`,
  name: id,
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "deck",
  location: null,
  might: 1,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...extra
});

const withTrash = (ids) => {
  const kernel = world().deck(["deck:1", "deck:2", "deck:3", "deck:4"]).build();
  for (const id of ids) {
    kernel.addObject(trashCard(id), "deck");
    kernel.perform({ type: "move-zone", object: kernel.ref(id), to: "trash" });
  }
  return kernel;
};

/** One continuous.might registration shaped like the layer engine's own specs. */
const mightEffect = (kernel, amount, id = "mundo-static") => [{
  effect: {
    id,
    layer: "arithmetic",
    source: kernel.ref("mundo"),
    filter: { objectId: "mundo", zone: "board" },
    effect: { kind: "continuous.might", mode: "add", amount }
  },
  duration: { type: "permanent" }
}];

test("Dr. Mundo, Expert program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Dr. Mundo, Expert identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-e6d907e16eabec4df39898b5e0b88759b3c4a756d746eb210b9feaa3437d822e"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /count/);
  assert.match(program.judgeReason, /479\.4/);
  assert.match(program.judgeReason, /programs\/statics\.ts/);
  assert.match(program.judgeReason, /beginning-start/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.equal(program.sourceText,
    "My Might is increased by the number of cards in your trash.\n" +
      "At the start of your Beginning Phase, recycle 3 from your trash."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: static Might bonus counted from the controller's trash", () => {
  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.might");
  assert.equal(staticAbility.effect.mode, "add");
  assert.equal(staticAbility.effect.layer, "arithmetic");
  assert.equal(staticAbility.effect.appliesTo, "self");
  // 479.4：加法层；数值来自「你垃圾场的牌数」的动态计数。
  assert.deepEqual(staticAbility.effect.amount, {
    kind: "count",
    subject: "cards",
    filter: { zone: "trash", owner: "controller" }
  });
  assert.equal(staticAbility.condition, undefined);
});

test("structure: Beginning Phase trigger recycling 3 from your trash", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "beginning-start");
  assert.deepEqual(triggered.trigger.filter, {
    event: "beginning-start",
    player: "controller"
  });
  assert.equal(triggered.trigger.once, undefined, "start-of-phase trigger fires every turn");
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
  const [recycle] = triggered.body;
  assert.equal(recycle.id, "mundo.recycle-3");
  assert.equal(recycle.op, "effect.recycle");
  // 417.6："Recycle X from [Zone]" 是非目标选择 → from 形式。
  assert.equal(recycle.targets, undefined);
  assert.equal(recycle.picks, undefined);
  assert.deepEqual(recycle.args.from, c({
    zone: "trash",
    owner: "controller",
    amount: c(3)
  }));
});

test("golden: recycle 3 from trash takes exactly the three chosen cards to the deck bottom", () => {
  const kernel = withTrash(["t1", "t2", "t3", "t4"]);
  const answer = [kernel.ref("t1"), kernel.ref("t2"), kernel.ref("t3")];
  kernel.setAnswers({
    "mundo.recycle-3/effect.recycle%3Atrash%3Acontroller%3A3": answer
  });

  const outcome = resolveChainBody(triggered.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.recycledCount, 3);
  assert.equal(kernel.objectsInZone("A", "trash").length, 1);
  assert.deepEqual(
    kernel.objectsInZone("A", "trash").map(ref => ref.id),
    ["t4"]
  );
  // 417.1：回收的牌进入牌库底部；牌库底三张即被选中的三张。
  const deck = kernel.objectsInZone("A", "deck").map(ref => ref.id);
  assert.deepEqual(deck.slice(-3).sort(), ["t1", "t2", "t3"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["recycle", "recycle", "recycle"]);
});

test("golden: 417.4 — fewer than 3 cards in trash recycles as many as possible", () => {
  const kernel = withTrash(["t1", "t2"]);
  kernel.setAnswers({
    "mundo.recycle-3/effect.recycle%3Atrash%3Acontroller%3A3": [kernel.ref("t1"), kernel.ref("t2")]
  });

  const outcome = resolveChainBody(triggered.body, kernel);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.recycledCount, 2);
  assert.equal(kernel.objectsInZone("A", "trash").length, 0);
});

test("golden: an empty trash recycles nothing and does not fail the trigger", () => {
  const kernel = world().deck(["deck:1"]).build();
  const outcome = resolveChainBody(triggered.body, kernel);

  // 417.4 的“能做多少做多少”：一张都选不出来时不提交动作，链接计数为 0。
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.recycledCount, 0);
  assert.deepEqual(outcome.events, []);
});

test("current gap 1: the arithmetic layer does not evaluate a count amount (CR 479.4)", () => {
  // The merged continuous.might path is registered and works for a numeric
  // amount; the count expression is what the layer engine cannot resolve.
  const kernel = world().unit("mundo", { might: 6, owner: "A", controller: "A" }).build();
  kernel.addObject(trashCard("t1"), "deck");
  kernel.perform({ type: "move-zone", object: kernel.ref("t1"), to: "trash" });
  assert.equal(kernel.objectsInZone("A", "trash").length, 1);

  const counted = createLayerEngine(kernel.objects, mightEffect(kernel, staticAbility.effect.amount));
  assert.equal(counted.evaluate(kernel.ref("mundo")).might, 6, "count amount falls back to 0, so no bonus applies");

  // Control: the same registration with a literal amount does apply, which
  // isolates the gap to count evaluation rather than to layer membership.
  const literal = createLayerEngine(kernel.objects, mightEffect(kernel, c(1), "mundo-static-literal"));
  assert.equal(literal.evaluate(kernel.ref("mundo")).might, 7);

  // And it would have to be re-evaluated as the trash changes (479.4), not
  // locked at entry: one more card in the trash must raise the bonus again.
  kernel.addObject(trashCard("t2"), "deck");
  kernel.perform({ type: "move-zone", object: kernel.ref("t2"), to: "trash" });
  assert.equal(createLayerEngine(kernel.objects, mightEffect(kernel, staticAbility.effect.amount)).evaluate(kernel.ref("mundo")).might, 6);
  assert.equal(createLayerEngine(kernel.objects, mightEffect(kernel, c(1), "mundo-static-literal")).evaluate(kernel.ref("mundo")).might, 7);
});

test("current gap 2: the Beginning Phase trigger cannot be registered by the production binder", () => {
  // events/trigger-spec.ts accepts only the closed EVENT_PATTERN_TYPES list.
  // `beginning-start` is a turn phase timing point, not an event pattern, so
  // the whole registration fails and the trigger never fires.
  const state = fixture({ cards: [{ id: "mundo", cardId: program.canonicalCardId, types: ["unit"], might: 6 }] });
  const errors = [];
  createProgramBinding({ cardPrograms: [forged] }).attachLifecycle(state.engine, error => errors.push(String(error && error.message)));
  state.engine.commit({ type: "move-zone", object: state.kernel.ref("mundo"), to: "board", location: { type: "base", player: "A" } });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /trigger\.filter\.event/);
  assert.match(errors[0], /beginning-start|值必须属于/);
  let registered = 0;
  for (const key of ["triggers", "registrations"]) if (state.engine.pipeline[key] instanceof Map) registered += state.engine.pipeline[key].size;
  assert.equal(registered, 0);

  // The static half does register through the same lifecycle (it is a plain
  // continuous.might), so only the amount evaluation and the trigger are open.
  assert.equal(state.engine.layers.registry.list().length, 1);
});

test.todo(
  "Dr. Mundo, Expert: evaluate the count amount in the arithmetic layer and re-apply it as the trash changes " +
    "(CR 479.4), and register the Beginning Phase trigger once phase timing points are accepted by the trigger " +
    "spec vocabulary"
);
test.todo(
  "Dr. Mundo, Expert: bind the static continuous.might count amount into the production LayerEngine from " +
    "the CardProgram adapter (CR 479.4)"
);

