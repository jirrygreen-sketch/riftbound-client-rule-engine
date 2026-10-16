import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/dr-mundo-expert.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [staticAbility, triggered] = program.abilities;
const c = value => ({ kind: "constant", value });

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
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /479\.4/);
  assert.equal(
    program.sourceText,
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
  // 479.1/479.2：加法层；数值来自「你垃圾场的牌数」的动态计数。
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
  assert.deepEqual(
    outcome.events.map(event => event.action),
    ["recycle", "recycle", "recycle"]
  );
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

test.todo(
  "Dr. Mundo, Expert: applying 'My Might is increased by the number of cards in your trash' as a " +
    "dynamic arithmetic-layer amount needs count evaluation in LayerEngine and the CardProgram-to-layers " +
    "binding (CR 479.4; RIFT-257)"
);

test.todo(
  "Dr. Mundo, Expert: the CardProgram adapter must bind the phase trigger and static continuous.might " +
    "effect into the production runtime (beginning-start / RIFT-257)"
);
