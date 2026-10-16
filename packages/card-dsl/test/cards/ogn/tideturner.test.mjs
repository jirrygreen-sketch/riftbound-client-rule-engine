import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/tideturner.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-2e073bafe3ab30d9d490463b071263df4273ed757b8f819b07328932fa2b04a5";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me, you may choose a friendly unit. Move me to its location and it to " +
  "my original location.";

const [keyword, triggered] = program.abilities;
const [swap] = triggered.body;
const [origin, chosenLocation, moveMe, moveChosen] = swap.args.body.value;

/** 剥离 IR 里的目标声明，模拟 Finalize 已锁定目标后的解释器调用（契约 3.6）。 */
function withLockedTargets(body) {
  return body.map(({ targets, picks, ...rest }) => rest);
}

/** 递归剥离 choice.optional body 里的目标声明。 */
function withLockedChoiceTargets(instruction) {
  return {
    ...instruction,
    args: {
      ...instruction.args,
      body: {
        ...instruction.args.body,
        value: withLockedTargets(instruction.args.body.value)
      }
    }
  };
}

test("tideturner: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("tideturner: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /RIFT-84/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("tideturner: [Hidden] keyword + play trigger with a choice.optional body", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "hidden" });
  assert.equal(keyword.value, undefined);

  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);

  // CR 355.1/3.9: “you may choose a friendly unit” 的被选指令包在 body 里。
  assert.equal(swap.op, "choice.optional");
  assert.equal(swap.linkedTo, undefined);
  assert.deepEqual(
    swap.args.body.value.map((instruction) => [instruction.id, instruction.op]),
    [
      ["tideturner.origin", "condition.value"],
      ["tideturner.chosen-location", "condition.value"],
      ["tideturner.move-me", "effect.move"],
      ["tideturner.move-chosen", "effect.move"]
    ]
  );
});

test("tideturner: the friendly unit is a target and both original locations are locked first", () => {
  // CR 355.5/355.7: 需要指名一个游戏对象 → 目标。
  assert.equal(chosenLocation.targets.length, 1);
  const [spec] = chosenLocation.targets;
  assert.equal(spec.id, "friendly-unit");
  assert.deepEqual(spec.filter, { type: "unit", controller: "self" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");

  // CR 355.4 / 448.3: 两次移动的目的地都必须在移动前锁定，否则会读到移动后的位置。
  assert.deepEqual(origin.args.value, {
    kind: "object-property",
    object: "self",
    property: "location"
  });
  assert.deepEqual(origin.args.key, { kind: "constant", value: "origin" });
  assert.equal(origin.targets, undefined);
  assert.deepEqual(chosenLocation.args.value, {
    kind: "object-property",
    object: { target: "friendly-unit" },
    property: "location"
  });
  assert.deepEqual(chosenLocation.args.key, { kind: "constant", value: "chosenLocation" });

  // 两次 Move 都读链接值作为目的地；第二次移动读第一条锁定的原始位置。
  assert.deepEqual(moveMe.args.objects, { kind: "constant", value: "self" });
  assert.deepEqual(moveMe.args.to, {
    kind: "linked-value",
    instructionId: "tideturner.chosen-location",
    key: "chosenLocation"
  });
  assert.equal(moveMe.targets, undefined);
  assert.deepEqual(moveChosen.args.objects, {
    kind: "constant",
    value: { target: "friendly-unit" }
  });
  assert.deepEqual(moveChosen.args.to, {
    kind: "linked-value",
    instructionId: "tideturner.origin",
    key: "origin"
  });
  assert.deepEqual(moveChosen.targets, [spec]);
});

test("tideturner golden: accepting swaps the two units' locations", () => {
  const base = world()
    .unit("tideturner", { location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { location: { type: "battlefield", id: "bf-2" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("tideturner") });
  kernel.setTargets("friendly-unit", [kernel.ref("ally")]);
  kernel.setAnswers({ "tideturner.swap/optional": true });

  const outcome = resolveChainBody(
    triggered.body.map(withLockedChoiceTargets),
    kernel
  );
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["tideturner.origin", "executed"],
    ["tideturner.chosen-location", "executed"],
    ["tideturner.move-me", "executed"],
    ["tideturner.move-chosen", "executed"],
    ["tideturner.swap", "executed"]
  ]);
  assert.deepEqual(kernel.getObject("tideturner").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(kernel.getObject("ally").location, { type: "battlefield", id: "bf-1" });
  assert.equal(outcome.linkedValues["tideturner.swap/tideturner.move-me.movedMe"].count, 1);
  assert.equal(outcome.linkedValues["tideturner.swap/tideturner.move-chosen.movedChosen"].count, 1);
});

test("tideturner golden: declining performs no move", () => {
  const base = world()
    .unit("tideturner", { location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { location: { type: "battlefield", id: "bf-2" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("tideturner") });
  kernel.setTargets("friendly-unit", [kernel.ref("ally")]);
  kernel.setAnswers({ "tideturner.swap/optional": false });

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.deepEqual(outcome.results.map((entry) => entry.id), ["tideturner.swap"]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.getObject("tideturner").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(kernel.getObject("ally").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "tideturner: [Hidden] 的藏牌、后续 [Reaction] 与 0 能量打出（811.1.d / 811.5）依赖 Hide 的" +
    "面向区域契约与 cost.hidden 消费方（RIFT-84 展开已合入，运行时未接线）"
);
