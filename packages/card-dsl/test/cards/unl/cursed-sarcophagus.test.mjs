import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/cursed-sarcophagus.js";
import playableUnit from "../../../dist/cards/ogn/pit-crew.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-fb1cb45cbf77fdbc4ca293043af3cc16004e296598831688330ddb35495711c7";
const SOURCE_TEXT =
  "When you play this, banish all units from your trash.\n" +
  ":rb_exhaust:: Play a unit banished with this. (You must pay its costs.)";

const [onPlay, activated] = program.abilities;
const [banishInstruction] = onPlay.body;
const trashUnitsPick = banishInstruction.picks[0];
const [playInstruction] = activated.body;
const banishedPick = playInstruction.picks[0];

test("unl-148-219 Cursed Sarcophagus: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-148-219 Cursed Sarcophagus: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README 第 2 节：judgeReason 必须点名缺哪个语义与依赖任务。
  assert.match(program.judgeReason, /394/);
  assert.match(program.judgeReason, /428\.3\.a/);
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /effect\.play/);
  // Re-probed 2026-10-17: the receipt exists for one resolution but has no
  // incarnation-scoped persistence for the later activation.
  assert.match(program.judgeReason, /ResolveContext|linked 作用域/);
  assert.match(program.judgeReason, /ordered pick plan/);
});

test("unl-148-219 Cursed Sarcophagus: 'When you play this' subscribes to card-played for this card", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(onPlay.kind, "triggered");
  // 383.4.a.1：Gear 的 Play Effect = card-played 指向自身。
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "self" }
  });
  assert.equal(onPlay.optional, false);
});

test("unl-148-219 Cursed Sarcophagus: 'banish all units from your trash' is a non-target 'all' pick", () => {
  assert.deepEqual(onPlay.body.map(instruction => instruction.id), [
    "cursed-sarcophagus.banish-trash-units"
  ]);
  assert.equal(banishInstruction.op, "effect.banish");
  // 355.10.d / 355.9.a.1："all units" 按特征自动选定，不是目标。
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { pick: "cursed-sarcophagus.trash-units" }
  });
  assert.deepEqual(banishInstruction.args.linkKey, {
    kind: "constant",
    value: "banishedTrashUnits"
  });
  assert.equal(banishInstruction.targets, undefined);
  assert.equal(banishInstruction.linkedTo, undefined);
  assert.deepEqual(trashUnitsPick, {
    id: "cursed-sarcophagus.trash-units",
    options: ["all-units-in-your-trash"],
    filter: { zone: "trash", type: "unit", owner: "self" },
    min: 0,
    max: null,
    selection: "all"
  });
});

test("unl-148-219 Cursed Sarcophagus: the [E] activation keeps the exhaust cost and the banned-with-this pick shape", () => {
  // 151 / 151.2 / 415.4 / 415.5：Gear 的启动能力，费用为横置来源。
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  assert.deepEqual(activated.body.map(instruction => instruction.id), [
    "cursed-sarcophagus.play-banished-unit"
  ]);
  assert.equal(playInstruction.op, "effect.play");
  // 394–398 / 428.3.a：只能引用本组能力放逐的牌；该作用域没有可执行读取路径（见
  // judgeReason），所以保留占位选择器，不查询整个 banishment。
  assert.deepEqual(playInstruction.args.pick, {
    kind: "constant",
    value: "cursed-sarcophagus.unit-banished-with-this"
  });
  // 原文没有印刷目的地，因此不写 location；省略 cost 覆盖后走 420.3 正常付费。
  assert.equal(playInstruction.args.location, undefined);
  assert.equal(playInstruction.args.cost, undefined);
  assert.deepEqual(banishedPick, {
    id: "cursed-sarcophagus.unit-banished-with-this",
    options: ["runtime:units-banished-with-cursed-sarcophagus"],
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-148-219 Cursed Sarcophagus: the trash-to-banishment half executes through the interpreter", () => {
  const kernel = world()
    .unit("gear-card", { zone: "trash", types: ["gear"], owner: "A" })
    .unit("fallen-a", { zone: "trash", types: ["unit"], owner: "A" })
    .unit("fallen-b", { zone: "trash", types: ["unit"], owner: "A" })
    .build();
  // Finalize 锁定非目标 pick（355.15）；已合入的 picks 由内核 provision，测试不手改状态。
  kernel.setPicks("cursed-sarcophagus.trash-units", [kernel.ref("fallen-a"), kernel.ref("fallen-b")]);
  const outcome = runAbilityBody([banishInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // 428.1：两个单位进入拥有者的 Banishment，gear 留在 trash。
  assert.deepEqual(kernel.zone("A", "banishment").map(ref => ref.id), ["fallen-a", "fallen-b"]);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["gear-card"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["banish", "banish"]);
});

test("unl-148-219 Cursed Sarcophagus: the banish receipt is linked for the same resolution", () => {
  const kernel = world().unit("fallen", { zone: "trash", types: ["unit"], owner: "A" }).build();
  kernel.setPicks("cursed-sarcophagus.trash-units", [kernel.ref("fallen")]);
  const outcome = runAbilityBody([banishInstruction], kernel);

  assert.equal(outcome.status, "executed");
  const receipt = outcome.linkedValues["cursed-sarcophagus.banish-trash-units.banishedTrashUnits"];
  assert.equal(receipt.count, 1);
  assert.deepEqual(receipt.objects.map(ref => ref.id), ["fallen"]);
});

test("unl-148-219 Cursed Sarcophagus: an empty trash moves nothing and produces no event", () => {
  // "all units" 是空集合时的边界：已合入的 effect.banish 对空的正向非目标选择不会去动任何
  // 对象，也不会发出事件（本测试只锁状态事实，不把某个 status 写成预期）。
  const kernel = world()
    .unit("gear-card", { zone: "trash", types: ["gear"], owner: "A" })
    .build();
  kernel.setPicks("cursed-sarcophagus.trash-units", []);
  runAbilityBody([banishInstruction], kernel);

  assert.deepEqual(kernel.zone("A", "banishment"), []);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["gear-card"]);
  assert.deepEqual(kernel.events, []);
});

test("unl-148-219 Cursed Sarcophagus: effect.banish executes the printed banish on the reference kernel", () => {
  const kernel = world()
    .unit("unit-a", { zone: "trash", types: ["unit"], owner: "A" })
    .unit("gear-a", { zone: "trash", types: ["gear"], owner: "A" })
    .build();
  const run = runInstruction(
    banish,
    { objects: banishInstruction.args.objects, linkKey: banishInstruction.args.linkKey },
    { world: kernel, picks: { "cursed-sarcophagus.trash-units": [kernel.ref("unit-a")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.banishedTrashUnitsCount, 1);
  assert.deepEqual(kernel.zone("A", "banishment").map(ref => ref.id), ["unit-a"]);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["gear-a"]);
});

test("unl-148-219 Cursed Sarcophagus boundary: the banish receipt exists only inside its own resolution, not for a later activation (CR 394-398)", () => {
  // The play effect writes a real linked receipt, but the link lives on the
  // ResolveContext/interpreter scope. A second, later ability body resolving on
  // the same kernel starts with no such link: this is the production shape that
  // makes "a unit banished with this" unavailable to the activated ability.
  const kernel = world().unit("fallen", { zone: "trash", types: ["unit"], owner: "A" }).build();
  kernel.setPicks("cursed-sarcophagus.trash-units", [kernel.ref("fallen")]);
  const first = runAbilityBody([banishInstruction], kernel);
  assert.equal(first.status, "executed");
  const banished = kernel.zone("A", "banishment").map((ref) => ref.id);
  assert.deepEqual(banished, ["fallen"]);
  assert.equal(first.linkedValues["cursed-sarcophagus.banish-trash-units.banishedTrashUnitsCount"], 1);

  // A later resolution starts from the same game state but a fresh link scope:
  // the same instruction id is not present, so the selector fails closed. (The
  // kernel here is rebuilt from the post-banishment zone state, not cloned, since
  // TestWorld.clone carries the link map over and would hide this gap.)
  const later = world().unit("fallen", { zone: "banishment", types: ["unit"], owner: "A" }).build();
  const second = runAbilityBody([{
    id: "probe-linked",
    op: "condition.value",
    args: {
      value: {
        kind: "linked-value",
        instructionId: "cursed-sarcophagus.banish-trash-units",
        key: "banishedTrashUnits"
      }
    }
  }], later);
  assert.equal(second.status, "partial");
  assert.equal(second.results[0].result.status, "ignored");
  assert.equal(second.results[0].result.reason, "mistargeted");
  assert.equal(second.linkedValues["probe-linked.value"], undefined);
  // The card's own activated pick remains a descriptive runtime selector: the
  // global Banishment cannot be queried without mixing in other sources.
  assert.deepEqual(banishedPick.options, ["runtime:units-banished-with-cursed-sarcophagus"]);
});
test("Cursed Sarcophagus golden: the authored activation pays the chosen unit's printed energy cost through production Finalize (420.3)", () => {
  // The pick is provisioned externally: this proves payment/play, not the
  // unresolved provenance of units banished with this particular Sarcophagus.
  const binding = createProgramBinding({ cardPrograms: [playableUnit] });
  const board = fixture({
    cards: [
      { id: "sarcophagus", cardId: CANONICAL_ID, types: ["gear"], energy: 4, power: ["Chaos"], might: null },
      { id: "pit-crew", cardId: playableUnit.canonicalCardId, types: ["unit"], energy: 3, power: null, might: 3 }
    ],
    describePlay: binding.describePlay,
    choose: request => request.type === "select-objects"
      ? request.options.filter(ref => ref.id === "pit-crew")
      : undefined
  });
  binding.attachLifecycle(board.engine);
  assert.equal(board.engine.commit({
    type: "move-zone", object: board.kernel.ref("sarcophagus"), to: "base", location: { type: "base", player: "A" }
  }).status, "done");
  assert.equal(board.engine.commit({ type: "banish", object: board.kernel.ref("pit-crew") }).status, "done");
  board.kernel.setPicks(banishedPick.id, [board.kernel.ref("pit-crew")]);
  board.engine.advance();
  board.engine.execute(board.draft("sarcophagus-activation", {
    source: board.kernel.getObject("sarcophagus"),
    speed: activated.timing,
    body: activated.body,
    cost: { id: "sarcophagus-exhaust", cost: activated.cost }
  }));
  resolveAll(board.engine);
  assert.equal(board.kernel.getObject("sarcophagus").exhausted, true);
  assert.equal(board.kernel.player("A").energy, 17);
  assert.deepEqual(board.kernel.player("A").power, []);
  assert.equal(board.kernel.getObject("pit-crew").zone, "board");
  assert.deepEqual(board.kernel.getObject("pit-crew").location, { type: "base", player: "A" });
  assert.equal(board.kernel.getObject("pit-crew").exhausted, true);
  assert.equal(board.engine.items.length, 0);
});
