import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/jarvan-iv-royal-heir.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import Assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-7218705147869fc19076fda9afe7138fbf4e76073f7e76ef76bb5cb0d67feee9";
const TARGET_ID = "jarvan-iv-royal-heir.unit-you-control";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const triggered = () => program.abilities[2];

test("rad-133-167 Jarvan IV, Royal Heir: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("continuous.might"), true);
  assert.equal(
    program.sourceText,
    "[Assault] (+1 :rb_might: while I'm attacking.)\n" +
      "[Tank] (I must be assigned combat damage first.)\n" +
      "When I attack, you may move a unit you control to my battlefield."
  );
});

test("rad-133-167 Jarvan IV, Royal Heir: [Assault] + [Tank] 声明与 383.3.a 的可选攻击触发", () => {
  assert.equal(program.abilities.length, 3);
  const [assault, tank, attack] = program.abilities;
  assert.deepEqual(assault, { kind: "keyword", keyword: "assault" });
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });

  assert.equal(attack.kind, "triggered");
  assert.equal(attack.trigger.at, "attack-declared");
  assert.deepEqual(attack.trigger.filter, { self: true });
  // 383.3.a："you may" 是效果第一段 → Finalize 时决定是否执行该触发能力。
  assert.equal(attack.optional, true);

  assert.equal(attack.body.length, 1);
  const instruction = attack.body[0];
  assert.equal(instruction.id, "jarvan-iv-royal-heir.move-unit-to-my-battlefield");
  assert.equal(instruction.op, "effect.move");
  assert.deepEqual(instruction.args.objects, { kind: "constant", value: { target: TARGET_ID } });
  // "to my battlefield"：来源的当前位置在结算时求值。
  assert.deepEqual(instruction.args.to, { kind: "object-property", object: "source", property: "location" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets.length, 1);
  assert.deepEqual(instruction.targets[0].filter, { type: "unit", zone: "board", controller: "controller" });
  assert.equal(instruction.targets[0].selection, "one");
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-133-167 Jarvan IV, Royal Heir: 触发的移动把己方单位移到来源战场（448-455）", () => {
  const kernel = world()
    .unit("jarvan", { location: BATTLEFIELD, might: 7 })
    .unit("ally", { location: { type: "base", player: "A" }, might: 2 })
    .build();
  const allyRef = kernel.ref("ally");
  const instruction = triggered().body[0];
  const run = runInstruction(
    move,
    {
      objects: instruction.args.objects,
      // 参考内核用运行时引用表达来源位置；静态 IR 里是 ObjectSelector "source"。
      to: { kind: "object-property", object: kernel.ref("jarvan"), property: "location" },
      amount: instruction.args.amount
    },
    { world: kernel, targets: { [TARGET_ID]: [allyRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(run.linked.moved.objects, [allyRef]);
  assert.deepEqual(run.linked.moved.movements, [
    { object: allyRef, from: { type: "base", player: "A" }, to: BATTLEFIELD }
  ]);
  assert.deepEqual(kernel.getObject("ally").location, BATTLEFIELD);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("rad-133-167 Jarvan IV, Royal Heir: 已在目标战场的单位不算移动" , () => {
  const kernel = world()
    .unit("jarvan", { location: BATTLEFIELD })
    .unit("ally", { location: BATTLEFIELD })
    .build();
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: TARGET_ID } },
      to: { kind: "object-property", object: kernel.ref("jarvan"), property: "location" },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, targets: { [TARGET_ID]: [kernel.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.moved, { count: 0, objects: [], movements: [] });
  assert.deepEqual(run.events, []);
});

test("rad-133-167 Jarvan IV, Royal Heir: 目标离区后指令 ignored（359.3.e.5–e.8）", () => {
  const kernel = world()
    .unit("jarvan", { location: BATTLEFIELD })
    .unit("ally", { location: { type: "base", player: "A" } })
    .build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: TARGET_ID } },
      to: { kind: "object-property", object: kernel.ref("jarvan"), property: "location" },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, targets: { [TARGET_ID]: [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});


test("rad-133-167 Jarvan IV, Royal Heir: 参考内核不解析 \"controller\" 占位符 → 目标集合为空时指令被忽略", () => {
  // 生产链在 Finalize 把 TargetSpec 的 controller 占位符（"controller"/"you"）解析成具体玩家；
  // 参考测试内核按值精确比较，因此这里选不到目标，指令按 359.3.e.5 被 ignored。
  // 这条断言记录的是内核边界，不是卡牌行为：真实移动本体由下一个 runInstruction 用例验证。
  const kernel = world()
    .unit("jarvan", { location: BATTLEFIELD, might: 7 })
    .unit("ally", { location: { type: "base", player: "A" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("jarvan") });
  scoped.setTargets(TARGET_ID, [kernel.ref("ally")]);
  const outcome = runAbilityBody(triggered().body, scoped, undefined, { host: kernel.ref("jarvan") });
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.deepEqual(scoped.getObject("ally").location, { type: "base", player: "A" });
  // 声明的静态形状本身是正确的符号选择器（不是运行时 ObjectRef）。
  assert.equal(triggered().body[0].args.to.kind, "object-property");
  assert.equal(triggered().body[0].args.to.object, "source");
});

test("rad-133-167 Jarvan IV, Royal Heir: [Assault] 展开本体属于关键词文件，卡牌只声明", () => {
  const expanded = Assault.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].kind, "static");
  assert.equal(expanded[0].effect.kind, "continuous.might");
  assert.equal(expanded[0].effect.amount.value, 1);
  // 卡牌程序里没有重复实现 Assault 的 Might 加值。
  assert.equal(
    program.abilities.filter(ability => ability.kind === "static" && ability.effect.kind === "continuous.might").length,
    0
  );
});

test.todo(
  "rad-133-167 Jarvan IV, Royal Heir: [Assault]（807.1.c 的 \"while I am an attacker, +1 Might\"）与" +
    "[Tank]（815.1.b/c 的伤害分配要求）都缺展开/消费方：continuous.might 没有图层写入路径" +
    "（RIFT-91），combat/base-combat-allocation.ts 显式不绑定 Tank 优先级，designation 也还不在" +
    "ObjectSnapshot 里"
);

test.todo(
  "rad-133-167 Jarvan IV, Royal Heir: 攻击触发的注册（attack-declared 时点 → CardProgram 的 triggered" +
    "能力）需要事件管线接线（批 4）；当前只有原语与解释器层面的执行证据"
);

test.todo(
  "rad-133-167 Jarvan IV, Royal Heir: 解释器 dispatch 前对 args 求值 vs effect.move 的 argsSchema 要求" +
    "Expr（\"to\"）这一形状差异需要收敛，之后才能用 runAbilityBody 直跑整条声明体并断言移动事件；" +
    "当前用 runInstruction + 运行时引用给出移动本体的真实执行证据"
);
