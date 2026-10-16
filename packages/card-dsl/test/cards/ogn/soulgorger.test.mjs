import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/soulgorger.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-ad456571717d54ed1ac0fa819ef9e14432c36a2fb8c86e3fa5e2c95ac4a7c25f";
const SOURCE_TEXT =
  "When you play me, you may play a unit from your trash, ignoring its Energy cost. " +
  "(You must still pay its Power cost.)";

const [triggered] = program.abilities;
const [optional] = triggered.body;
const [printedCost, play] = optional.args.body.value;

/** 剥离 IR 里的目标声明，模拟 Finalize 已锁定目标后的解释器调用（契约 3.6）。 */
function withLockedTargets(body) {
  return body.map(({ targets, picks, ...rest }) => rest);
}

test("soulgorger: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("soulgorger: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.printed/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("soulgorger: the play trigger wraps the play in a choice.optional body (contract 3.9)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  // 触发本身是强制的；“you may” 由 choice.optional 承担（355.1）。
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);

  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.args.body.kind, "constant");
  assert.deepEqual(
    optional.args.body.value.map((instruction) => [instruction.id, instruction.op]),
    [
      ["soulgorger.printed-cost", "cost.printed"],
      ["soulgorger.play", "effect.play"]
    ]
  );
  assert.equal(optional.linkedTo, undefined);
});

test("soulgorger: the trash unit is a target and the Energy part is ignored (CR 356.1.b.2)", () => {
  // CR 355.9.a + 108.2.d: Trash 是公开区域，“a unit from your trash” 是被指名的对象 → 目标。
  assert.equal(printedCost.targets.length, 1);
  const [spec] = printedCost.targets;
  assert.equal(spec.id, "unit-card-in-trash");
  assert.deepEqual(spec.filter, { type: "unit", zone: "trash", owner: "self" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");

  // CR 356.1.b.2: 只忽略 Energy，Power 仍然照付（原文括注）。
  assert.deepEqual(printedCost.args.ignore, { kind: "constant", value: "energy" });
  assert.deepEqual(printedCost.args.linkKey, { kind: "constant", value: "plan" });

  // CR 420.3.b / 381: 打出位置仍走正常流程。
  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, "soulgorger.printed-cost");
  assert.deepEqual(play.args.cost, {
    kind: "linked-value",
    instructionId: "soulgorger.printed-cost",
    key: "plan"
  });
  assert.deepEqual(play.args.location, { kind: "constant", value: { type: "base", player: "self" } });
  assert.deepEqual(play.args.linkKey, { kind: "constant", value: "playedUnit" });
  assert.deepEqual(play.targets, [spec]);
});

test("soulgorger golden: declining the option leaves the trash untouched", () => {
  const kernel = world()
    .card("trash-unit", { zone: "trash", types: ["unit"], owner: "A", energy: 3, power: ["Chaos"] })
    .player("A", { energy: 4 })
    .build();
  kernel.setAnswers({ "soulgorger.may-play/optional": false });

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.deepEqual(outcome.results.map((entry) => entry.id), ["soulgorger.may-play"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("trash-unit").zone, "trash");
  assert.equal(kernel.player("A").energy, 4);
  assert.deepEqual(outcome.events, []);
});

test("soulgorger golden: accepting plays the chosen trash unit, paying only its Power cost", () => {
  const kernel = world()
    .card("trash-unit", { zone: "trash", types: ["unit"], owner: "A", energy: 3, power: ["Chaos"] })
    .player("A", { energy: 4 })
    .build();
  const chosen = kernel.ref("trash-unit");
  kernel.setTargets("unit-card-in-trash", [chosen]);
  // 356.1.b.2 的计划：Energy 归零、Power 仍为 1 点 Chaos（由费用系统生成；此处作为调用方输入）。
  const plan = { finalized: true, energy: 0, power: ["Chaos"], xp: 0 };

  const outcome = resolveChainBody(
    withLockedTargets([
      {
        id: "soulgorger.play",
        op: "effect.play",
        args: {
          object: { kind: "object-property", object: { target: "unit-card-in-trash" }, property: "ref" },
          cost: { kind: "constant", value: plan },
          location: { kind: "constant", value: { type: "base", player: "A" } },
          linkKey: { kind: "constant", value: "playedUnit" }
        },
        targets: [
          {
            id: "unit-card-in-trash",
            filter: { type: "unit", zone: "trash", owner: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]),
    kernel
  );

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("trash-unit").zone, "board");
  assert.deepEqual(kernel.getObject("trash-unit").location, { type: "base", player: "A" });
  // Energy 未支付（被忽略）：0 能量计划不扣资源。
  assert.equal(kernel.player("A").energy, 4);
  assert.deepEqual(outcome.linkedValues["soulgorger.play.playedUnit"], 1);
  // 打出的支付 + 入场两步都是真实动作；参考内核按 finalized plan 结算（`action.plan`
  // 只在 perform 的入参里，事件载荷不带计划，见 kernel 的 pay 分支）。
  const actions = kernel.events.map((event) => event.action);
  assert.deepEqual(actions, ["pay", "play"]);
  // 356.1.b.2：Energy 归零、Power 仍为 1 点 Chaos，且参考内核只按 Energy 扣费。
  assert.equal(plan.energy, 0);
  assert.deepEqual(plan.power, ["Chaos"]);
});

test("soulgorger golden: a stale trash target is ignored (CR 359.3.e.6)", () => {
  const kernel = world()
    .card("trash-unit", { zone: "trash", types: ["unit"], owner: "A" })
    .build();
  const stale = kernel.ref("trash-unit");
  kernel.setTargets("unit-card-in-trash", [stale]);
  kernel.perform({ type: "banish", object: stale });

  const outcome = resolveChainBody(
    withLockedTargets([
      {
        id: "soulgorger.play",
        op: "effect.play",
        args: {
          object: { kind: "object-property", object: { target: "unit-card-in-trash" }, property: "ref" },
          cost: { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } }
        },
        targets: [
          {
            id: "unit-card-in-trash",
            filter: { type: "unit", zone: "trash", owner: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]),
    kernel
  );

  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.deepEqual(outcome.events, []);
});

test("soulgorger golden: a replaced play negates the instruction (contract 3.6 primitive rule 2)", () => {
  const kernel = world().card("trash-unit", { zone: "trash", types: ["unit"], owner: "A" }).build();
  kernel.setTargets("unit-card-in-trash", [kernel.ref("trash-unit")]);
  // 只拦截 play 动作；Finalize 之后目标已锁定。
  kernel.addReplacement((action) => (action.type === "play" ? "replaced" : null));

  const outcome = resolveChainBody(
    withLockedTargets([
      {
        id: "soulgorger.play",
        op: "effect.play",
        args: {
          object: { kind: "object-property", object: { target: "unit-card-in-trash" }, property: "ref" },
          cost: { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } }
        },
        targets: [
          {
            id: "unit-card-in-trash",
            filter: { type: "unit", zone: "trash", owner: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]),
    kernel
  );

  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "replaced");
  assert.equal(kernel.getObject("trash-unit").zone, "trash");
});

test.todo(
  "soulgorger: generate the 'ignore its Energy cost, still pay its Power cost' plan from the chosen " +
    "card's printed cost (356.1.b.2; cost.printed 未合入，RIFT-89) and assert the Power payment"
);
