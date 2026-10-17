import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/fate-weaver.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { finalizeOrderedPickPlans } from "../../../../engine-core/dist/chain/picks/plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-2bf8cfce91a22dad7d6fac1d1346fdddb3ac5cb4e68f17df57409a63ae23f366";
const SOURCE_TEXT =
  "When you play me, look at the top 4 cards of your Main Deck. You may reveal a spell " +
  "with Energy cost :rb_energy_4: or more from among them and draw it. Recycle the rest.";

const [ability] = program.abilities;
const [bind, look, optional, recycle] = ability.body;
const [reveal, draw] = optional.args.body.value;
const [lookedPick] = look.picks;
const [chosenPick] = reveal.picks;

/** A four-card deck plus the ordered top-4 the production Finalize must supply. */
const deckedWorld = () => world().deck(["top", "second", "third", "fourth", "fifth"]).build();

const orderedTop = (kernel, count = 4) =>
  kernel.zoneSlice("A", "deck", "top", count).map((object) => object.ref);

test("unl-064-219 Fate Weaver: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-064-219 Fate Weaver: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // 缺口必须具体：energy 下限过滤与选择集合成员约束。
  assert.match(program.judgeReason, /energy/);
  assert.match(program.judgeReason, /looked-at/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-064-219 Fate Weaver: card-played self trigger, then look → may reveal+draw → recycle", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { role: "self" } });
  assert.equal(ability.optional, false);

  assert.deepEqual(
    ability.body.map((entry) => [entry.id, entry.op]),
    [
      ["fate-weaver.bind-controller", "condition.value"],
      ["fate-weaver.look-top-4", "effect.inspect"],
      ["fate-weaver.may-reveal-spell", "choice.optional"],
      ["fate-weaver.recycle-rest", "effect.recycle"]
    ]
  );
});

test("unl-064-219 Fate Weaver: the look is a top-4 ordered inspect of the controller's deck", () => {
  assert.deepEqual(bind.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(bind.args.key, { kind: "constant", value: "controller" });
  assert.deepEqual(look.args.player, {
    kind: "linked-value",
    instructionId: "fate-weaver.bind-controller",
    key: "controller"
  });
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(look.args.picksSpecId, {
    kind: "constant",
    value: "fate-weaver.looked"
  });
  assert.deepEqual(lookedPick, {
    id: "fate-weaver.looked",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 4 } }
  });
});

test("unl-064-219 Fate Weaver: 'you may' wraps the reveal + draw instructions, and recycle is unlinked", () => {
  assert.equal(optional.linkedTo, "fate-weaver.look-top-4");
  assert.deepEqual(
    reveal,
    {
      id: "fate-weaver.reveal-spell",
      op: "effect.reveal",
      args: { pick: { kind: "constant", value: "fate-weaver.chosen-spell" } },
      picks: [
        {
          id: "fate-weaver.chosen-spell",
          options: [
            { kind: "linked-value", instructionId: "fate-weaver.look-top-4", key: "looked" }
          ],
          filter: { type: "spell", energyAtLeast: 4 },
          min: 1,
          max: 1,
          selection: "one"
        }
      ]
    }
  );
  assert.equal(draw.op, "effect.zone");
  assert.equal(draw.linkedTo, "fate-weaver.reveal-spell");
  assert.deepEqual(draw.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(chosenPick.filter, { type: "spell", energyAtLeast: 4 });

  // "Recycle the rest" 不链接可选指令：拒绝 reveal 只让那条指令 negated。
  assert.equal(recycle.linkedTo, undefined);
  assert.deepEqual(recycle.args.objects, {
    kind: "linked-value",
    instructionId: "fate-weaver.look-top-4",
    key: "looked"
  });
  assert.equal(recycle.targets, undefined);
});

test("unl-064-219 Fate Weaver golden: 'draw it' moves the chosen looked card to hand (425.4.a / 414.1)", () => {
  const kernel = deckedWorld();
  const viewed = orderedTop(kernel);
  kernel.setPicks(lookedPick.id, viewed);
  // 被选中的是 third（可执行路径只看集合来源，不实现 energy 下限过滤）。
  kernel.setPicks(chosenPick.id, [viewed[2]]);
  // 整条 body 按真实作用域执行；可选指令接受。effect.reveal 的 pick 由生产链适配器
  // 解码并消费已锁定的选择。
  kernel.setAnswers({ "fate-weaver.may-reveal-spell/optional": true });
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  // 解释器按「子指令先、容器后」记录完成顺序（见 effects/interpreter/README.md）。
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["fate-weaver.bind-controller", "executed"],
      ["fate-weaver.look-top-4", "executed"],
      ["fate-weaver.reveal-spell", "executed"],
      ["fate-weaver.draw-it", "executed"],
      ["fate-weaver.may-reveal-spell", "executed"],
      ["fate-weaver.recycle-rest", "executed"]
    ]
  );
  assert.deepEqual(outcome.results[2].result.linkedValues.revealed, [viewed[2]]);

  // 被展示并抽走的那张进入手牌；其余三张回收到底。
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["third"]);
  assert.deepEqual(
    kernel.zone("A", "deck").map((ref) => ref.id),
    ["fifth", "top", "second", "fourth"]
  );
  assert.equal(outcome.linkedValues["fate-weaver.look-top-4.lookedCount"], 4);
  assert.equal(outcome.linkedValues["fate-weaver.recycle-rest.recycledCount"], 3);
});

test("unl-064-219 Fate Weaver golden: declining the may skips only that instruction and still recycles", () => {
  const kernel = deckedWorld();
  const viewed = orderedTop(kernel);
  kernel.setPicks(lookedPick.id, viewed);
  kernel.setPicks(chosenPick.id, [viewed[0]]);
  kernel.setAnswers({ "fate-weaver.may-reveal-spell/optional": false });

  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[2].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(outcome.results[3].result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.equal(outcome.linkedValues["fate-weaver.recycle-rest.recycledCount"], 4);
});

test("unl-064-219 Fate Weaver golden: without the ordered top-4 source the look range stays empty and nothing is guessed", () => {
  const kernel = deckedWorld();
  kernel.setAnswers({ "fate-weaver.may-reveal-spell/optional": false });
  const outcome = resolveChainBody(ability.body, kernel);

  // 缺有序来源：effect.inspect 不截取 query 近似，范围为空；随后的可选指令没有可选项。
  assert.equal(outcome.linkedValues["fate-weaver.look-top-4.lookedCount"], 0);
  assert.deepEqual(outcome.linkedValues["fate-weaver.look-top-4.looked"], []);
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.deepEqual(
    kernel.zone("A", "deck").map((ref) => ref.id),
    ["top", "second", "third", "fourth", "fifth"]
  );
});

test.todo(
  "unl-064-219 Fate Weaver: the 'spell with Energy cost 4 or more' restriction needs a value-threshold " +
    "member filter (energy >= 4) on the looked set; the frozen ObjectFilter/PickSpec carries static data only"
);

test("unl-064-219 Fate Weaver: Finalize's ordered plan captures the real top-four deck slice", () => {
  const kernel = deckedWorld();
  const [plan] = finalizeOrderedPickPlans(kernel, ability.body);
  assert.equal(plan.id, "fate-weaver.looked");
  assert.deepEqual(plan.refs.map((ref) => ref.id), ["top", "second", "third", "fourth"]);
});
