import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/trifarian-captain.js";
import inspectDef from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import recycleDef from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import revealDef from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import zoneDef from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-fbb4180b4014bcdaba24acecc70f449a5510dc03c49ffb585d7ff8b7cdffea8a";
const TOP_FOUR = "trifarian-captain.top-four";
const CHOSEN = "trifarian-captain.chosen";

const triggered = () => program.abilities[0];
const instructionById = (id) => triggered().body.find(instruction => instruction.id === id);

test("rad-129-167 Trifarian Captain: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("zoneSlice"), true);
  assert.equal(
    program.sourceText,
    "When you play me, look at the top 4 cards of your Main Deck. You may reveal from among them a unit or gear with Energy cost no more than :rb_energy_3: and with Power cost no more than :rb_rune_rainbow: and draw it. Recycle the rest."
  );
});

test("rad-129-167 Trifarian Captain: look → 383.3.a.3 可选 reveal+入手 → recycle the rest", () => {
  assert.equal(program.abilities.length, 1);
  const ability = triggered();
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { self: true });
  assert.equal(ability.optional, false);

  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "trifarian-captain.look-top-four",
    "trifarian-captain.may-reveal-and-draw",
    "trifarian-captain.recycle-the-rest"
  ]);

  const look = instructionById("trifarian-captain.look-top-four");
  assert.equal(look.op, "effect.inspect");
  // 契约 3.6：牌库顶必须走 zoneSlice，effect.inspect 要求上游按序提供 picksSpecId。
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(look.args.picksSpecId, { kind: "constant", value: TOP_FOUR });
  assert.deepEqual(look.args.pickedKey, { kind: "constant", value: "lookedCards" });

  // "you may" 不是效果第一段（383.3.a.3）→ 结算时决定，包住 reveal + 入手。
  const choice = instructionById("trifarian-captain.may-reveal-and-draw");
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), [
    "trifarian-captain.reveal-chosen",
    "trifarian-captain.put-chosen-in-hand"
  ]);

  const [reveal, toHand] = choice.args.body.value;
  assert.equal(reveal.op, "effect.reveal");
  assert.deepEqual(reveal.args.pick, { kind: "constant", value: CHOSEN });
  assert.equal(reveal.picks.length, 1);
  assert.equal(reveal.picks[0].id, CHOSEN);
  assert.deepEqual(reveal.picks[0].options, [
    { kind: "linked-value", instructionId: "trifarian-captain.look-top-four", key: "lookedCards" }
  ]);
  // 限制：unit or gear、能量 ≤3、力量 ≤1（IR 无数值比较键，只能描述）。
  assert.deepEqual(reveal.picks[0].filter, {
    type: ["unit", "gear"],
    zone: "deck",
    energyAtMost: 3,
    powerAtMost: 1
  });
  assert.equal(reveal.picks[0].selection, "one");

  assert.equal(toHand.op, "effect.zone");
  assert.equal(toHand.linkedTo, "trifarian-captain.reveal-chosen");
  assert.deepEqual(toHand.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(toHand.args.pick, { kind: "constant", value: CHOSEN });

  const recycle = instructionById("trifarian-captain.recycle-the-rest");
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked-value",
    instructionId: "trifarian-captain.look-top-four",
    key: "lookedRest"
  });
  assert.equal(recycle.linkedTo, undefined);
});

test("rad-129-167 Trifarian Captain: effect.inspect 按 zoneSlice 的牌库顺序真实查看 4 张", () => {
  const kernel = world().deck(["top", "second", "third", "fourth", "fifth"]).unit("trifarian", {}).build();
  const orderedTopFour = kernel.zoneSlice("A", "deck", "top", 4).map(object => object.ref);
  const run = runInstruction(
    inspectDef,
    {
      player: { kind: "object-property", object: kernel.ref("trifarian"), property: "controller" },
      zone: { kind: "constant", value: "deck" },
      scope: { kind: "constant", value: "top" },
      amount: { kind: "constant", value: 4 },
      picksSpecId: { kind: "constant", value: TOP_FOUR },
      linkedKey: { kind: "constant", value: "lookedCount" },
      pickedKey: { kind: "constant", value: "lookedCards" }
    },
    { world: kernel, picks: { [TOP_FOUR]: orderedTopFour } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.lookedCount, 4);
  assert.deepEqual(run.linked.lookedCards.map(ref => ref.id), ["top", "second", "third", "fourth"]);
  assert.deepEqual(run.events.map(event => event.action), ["look"]);
  // look 不改变区域：5 张仍在牌库。
  assert.equal(kernel.zone("A", "deck").length, 5);
});

test("rad-129-167 Trifarian Captain: 被查看牌可被 reveal 后置入手牌（124 换区）", () => {
  const kernel = world().deck(["top", "second", "third", "fourth"]).unit("trifarian", {}).build();
  const topFour = kernel.zone("A", "deck").slice(0, 4);
  const chosen = topFour[2];
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("trifarian") });
  scoped.setPicks(CHOSEN, [chosen]);

  const revealRun = runInstruction(revealDef, { pick: CHOSEN }, { world: scoped, picks: { [CHOSEN]: [chosen] } });
  assert.equal(revealRun.result.status, "executed");
  assert.deepEqual(revealRun.linked.revealed.map(ref => ref.id), ["third"]);

  const toHand = runInstruction(zoneDef, { pick: CHOSEN, to: { kind: "constant", value: "hand" } },
    { world: scoped, picks: { [CHOSEN]: [chosen] } });
  assert.equal(toHand.result.status, "executed");
  assert.deepEqual(scoped.zone("A", "hand").map(ref => ref.id), ["third"]);
  assert.deepEqual(scoped.zone("A", "deck").map(ref => ref.id), ["top", "second", "fourth"]);
});

test("rad-129-167 Trifarian Captain: Recycle the rest 把其余牌放到牌库底（417.1/417.4）", () => {
  const kernel = world().deck(["top", "second", "third", "fourth", "fifth"]).unit("trifarian", {}).build();
  const topFour = kernel.zone("A", "deck").slice(0, 4);
  const rest = [topFour[0], topFour[2], topFour[3]];
  const run = runInstruction(recycleDef, { objects: { kind: "constant", value: rest } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 3);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second", "fifth", "top", "third", "fourth"]);
  assert.deepEqual(run.events.map(event => event.action), ["recycle", "recycle", "recycle"]);
});

test("rad-129-167 Trifarian Captain: 拒绝 reveal 时 choice.optional 为 skipped，body 内的 reveal/入手都不执行", () => {
  // 解释器在 dispatch 前把整条指令的 args 求值，而 effect.inspect 的 argsSchema 要求
  // player 仍是 Expr，因此 look 指令只能走 runInstruction（见上一个用例）。这里单独执行
  // 声明的 choice.optional 节点，验证 383.3.a.3 的"结算时决定"在拒绝时的语义。
  const kernel = world().deck(["top", "second", "third", "fourth"]).unit("trifarian", {}).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("trifarian") });
  scoped.setAnswers({ "trifarian-captain.may-reveal-and-draw/optional": false });
  const outcome = runAbilityBody([instructionById("trifarian-captain.may-reveal-and-draw")], scoped);
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(scoped.events, []);
  assert.deepEqual(scoped.zone("A", "hand"), []);
  assert.equal(scoped.zone("A", "deck").length, 4);
});

test("rad-129-167 Trifarian Captain: 接受时的可选分支按声明顺序执行 reveal → 入手", () => {
  // effect.reveal / effect.zone 的 argsSchema 需要 Expr（解释器会先把 args 求值，
  // 因此整条能力体经 runAbilityBody 会在 effect.zone 的 `to` 上报类型错误，属已记录
  // 的原语/解释器参数形状差异）。这里按声明逐条执行原语，验证顺序与最终状态。
  const kernel = world().deck(["top", "second", "third", "fourth"]).unit("trifarian", {}).build();
  const chosen = kernel.zone("A", "deck")[0];
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("trifarian") });
  const [revealInstruction, toHandInstruction] = instructionById("trifarian-captain.may-reveal-and-draw").args.body.value;

  const revealRun = runInstruction(
    revealDef,
    { pick: revealInstruction.args.pick.value },
    { world: scoped, picks: { [CHOSEN]: [chosen] } }
  );
  assert.equal(revealRun.result.status, "executed");
  assert.deepEqual(revealRun.linked.revealed.map(ref => ref.id), ["top"]);
  // reveal 不改变区域。
  assert.deepEqual(scoped.zone("A", "deck").map(ref => ref.id), ["top", "second", "third", "fourth"]);

  const toHandRun = runInstruction(
    zoneDef,
    { pick: toHandInstruction.args.pick.value, to: { kind: "constant", value: "hand" } },
    { world: scoped, picks: { [CHOSEN]: [chosen] } }
  );
  assert.equal(toHandRun.result.status, "executed");
  assert.deepEqual(scoped.zone("A", "hand").map(ref => ref.id), ["top"]);
  assert.deepEqual(scoped.zone("A", "deck").map(ref => ref.id), ["second", "third", "fourth"]);
  assert.deepEqual(revealRun.events.map(event => event.action), ["reveal"]);
  // 108.7.b 的入手路径：内核把目标区域规范化为 return-to-hand（move-zone 的手牌形态）。
  assert.deepEqual(toHandRun.events.map(event => event.action), ["return-to-hand"]);
});

test.todo(
  "rad-129-167 Trifarian Captain: 牌库顶按序来源——effect.inspect 的 top 范围必须由上游按契约 3.6 的" +
    "zoneSlice 提供有序 picksSpecId，该生产接线属 RIFT-358（进行中），用 query 顺序冒充" +
    "牌库顶被原语显式禁止"
);

test.todo(
  "rad-129-167 Trifarian Captain: \"a unit or gear with Energy cost no more than 3 and with Power cost no" +
    " more than [rainbow]\" 是 355.9.b 的目标限制；ObjectFilter 没有数值比较键、Condition 无法对集合" +
    "逐项施加限制，当前只能作为描述性键记录（需要批 3 的目标系统扩展）"
);

test.todo(
  "rad-129-167 Trifarian Captain: \"the rest\" 需要 looked 集合减去被展示那张的补集；effect.inspect" +
    "只链接张数与引用列表，PickSpec 也没有 exclude 语义（程序里的 lookedRest 键需上游写入）"
);
