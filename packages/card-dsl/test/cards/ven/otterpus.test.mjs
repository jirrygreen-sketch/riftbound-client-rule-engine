import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/otterpus.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";

const [replacement] = program.abilities;

test("otterpus: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-88f5798e902358ceaf4c13e100918b603ddcdb5d2e0d5bc1d6df65283fdc2f61"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
  assert.equal(
    program.sourceText,
    "If a player would score 1 point from conquering or holding during their first or second turn, they draw 1 instead."
  );
});

test("otterpus: judgeReason names the scoring-player binding and per-player-turn gaps", () => {
  assert.match(program.judgeReason, /replacement/);
  assert.match(program.judgeReason, /replacement\/planner\.ts/);
  assert.match(program.judgeReason, /args\.target/);
  assert.match(program.judgeReason, /first or second turn/);
  assert.match(program.judgeReason, /485\.7|487\.7|490\.7|491\.7/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("otterpus: one replacement ability replaces the score event for any player", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(replacement.kind, "replacement");
  // 471.1 / 471.2：Conquer 与 Hold 都会发出 score；470.3/473.2 定义该计分。
  assert.deepEqual(replacement.replaces, { event: "score", player: "any" });
});

test("otterpus: the first-or-second-turn clause is an explicit per-player-turn predicate", () => {
  // 485.7/487.7/490.7/491.7：第一回合按模式与先后手对每个玩家分别调整，
  // 所以不能拿全局回合计数当条件；程序登记显式谓词，不近似。
  assert.deepEqual(replacement.condition, {
    kind: "expression",
    value: { kind: "constant", value: "per-player-turn-is-first-or-second" }
  });
});

test("otterpus: the replacing instruction draws exactly 1 and is not linked to anything", () => {
  assert.equal(replacement.with.length, 1);
  const [instruction] = replacement.with;
  assert.equal(instruction.id, "otterpus.draw-instead");
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.condition, undefined);
  // 替代效果没有"with 的第一条指令可被链接的前序指令"，所以不得写 linkedTo。
  assert.equal(replacement.with.some(item => item.linkedTo !== undefined), false);
});

test("otterpus: the replacing draw really draws 1 through the chain adapter", () => {
  const kernel = world().deck(["top", "next"]).build();
  const outcome = resolveChainBody(replacement.with, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(outcome.linkedValues["otterpus.draw-instead.drawn"], 1);
});

test("otterpus golden: the merged replacement binder turns the card's pattern into a real score replacement", () => {
  // RIFT-260 的 bindReplacement 把 replaces 模式变成 ReplacementRegistration、把
  // with 计划成封闭 GameAction：这是 470.1/470.3/471/473.2 的 score 替代，替身是
  // effect.draw；此处只验证 A 自己得分的已支持规划，玩家绑定和回合条件见 TODO。
  const kernel = world()
    .player("A")
    .player("B")
    .unit("otterpus", { zone: "board", cardId: program.canonicalCardId })
    .deck(["top", "next"])
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const { registration } = bindReplacement(replacement, kernel.ref("otterpus"), {
    host: {
      object: ref => kernel.object(ref),
      objects: () => kernel.objects,
      context: (source, controller) => host.context(source, controller, "score")
    },
    pipeline
  });

  assert.throws(() => pipeline.registerReplacement(registration), /Duplicate replacement/);
  const score = { type: "score", player: "A", amount: 1 };
  assert.equal(registration.matches(score, score), true);
  // 替代结果是一条真实的 draw 动作，而不是伪造的额外得分。
  assert.deepEqual(registration.apply(score, score), {
    status: "replace",
    actions: [{ type: "draw", player: "A", amount: 1 }]
  });
});

test.todo(
  "otterpus: bind the replaced scoring player to the draw of 'they draw 1 instead' — " +
    "replacement/planner.ts resolves effect.draw's player from args.target/default controller, so a " +
    "score by the other player would currently be answered with a draw for the ability controller"
);
test.todo(
  "otterpus: evaluate 'during their first or second turn' per scoring player (485.7/487.7/490.7/" +
    "491.7 First Turn Process) once a per-player turn predicate exists in Condition/HistoryQuery"
);

test.todo(
  "otterpus: commit a structural score-to-draw replacement through TurnFlow's real conquer/hold scoring " +
    "transaction, preserving control and the score ledger (470.1 / 471); replaced-scoring remains blocked"
);
