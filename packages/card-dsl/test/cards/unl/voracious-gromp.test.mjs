import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/voracious-gromp.js";
// card-dsl 不依赖 engine-core（方向相反），golden 执行按 workspace 布局直接加载已构建的 engine-core。
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f8b8f40872bd80284cc23f0fb215719625d48e00be1b8ed248c2a494ad0a5bad";
const SOURCE_TEXT = "[Hunt 3] (When I conquer or hold, gain 3 XP.)";

const [hunt] = program.abilities;

test("unl-100-219 Voracious Gromp: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-100-219 Voracious Gromp: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // judge-required 必须写清缺哪个操作/哪条规则/依赖哪个任务（README 第 2 节）。
  assert.match(program.judgeReason, /Hunt/);
  assert.match(program.judgeReason, /823\.1\.c\.1/);
  assert.match(program.judgeReason, /823\.2/);
  assert.match(program.judgeReason, /effect\.xp/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-100-219 Voracious Gromp: the only ability is the valued Hunt 3 keyword", () => {
  // 823.1 / 823.1.c / 823.1.c.3：Hunt 是带数值的触发式能力关键词，X = Hunt Value = 3。
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 3 });
  // 关键词只声明、不重写展开（契约 3.7 / README 第 5 节）。
  assert.equal(hunt.trigger, undefined);
  assert.equal(hunt.body, undefined);
});

test("unl-100-219 Voracious Gromp: the expansion's XP primitive is merged", () => {
  // 823.1.c.1 的展开会调用 effect.xp（730.1 / 733）；该原语本身已合入。
  // 这里刻意不断言「某关键词尚未合入」：那类断言会在依赖落地的那一刻反而失败（README 第 4 节：
  // 尚不可执行的部分只用 test.todo 注明缺什么）。
  assert.equal(instructionDefinitionsById.has("effect.xp"), true);
});

test("unl-100-219 Voracious Gromp golden: the expansion's 'gain 3 XP' half runs through the real primitive", () => {
  // 823.1.c.1 展开为 conquer / hold 触发，body 是「my controller gains X XP」；其中
  // gain-XP 这一步用已合入的 effect.xp（730.1 / 733）真实执行。获得者缺省即 ctx.controller。
  const kernel = world().player("A", { xp: 1 }).build();
  const run = runInstruction(xp, { amount: { kind: "constant", value: hunt.value } }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").xp, 4);
  assert.equal(run.linked.gainedTo, "A");
  assert.equal(run.linked.gained, 3);
  assert.deepEqual(run.events.map((event) => event.action), ["gain-xp"]);
});

test("unl-100-219 Voracious Gromp golden: the opponent's XP is untouched (732: XP is not shared)", () => {
  const kernel = world().player("A", { xp: 0 }).player("B", { xp: 2 }).build();
  const run = runInstruction(xp, { amount: { kind: "constant", value: 3 } }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").xp, 3);
  assert.equal(kernel.player("B").xp, 2);
});

test.todo(
  "voracious-gromp: effects/keywords/Hunt.ts——把 Hunt 3 展开为 conquer 与 hold（events/timing-points.ts 的两个封闭时点）" +
    "上各一个以 effect.xp 为 body 的触发能力，并按 823.2 把多来源 Hunt 数值相加合为一个触发"
);

test.todo(
  "voracious-gromp: CardProgram -> trigger 管线——没有订阅方把关键词展开出的 conquer / hold 触发注册进时点/链" +
    "（契约 3.5；引擎批 4 / RIFT-120 接线），且 scoring/ 侧尚未与 chain/events 单管线打通"
);
