import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/heimerdinger-academy-instructor.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-110bcd60a1458cca7d33a12f05a6abe079166042a12661fcba8d64b94016e80a";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const replacement = () => program.abilities[0];
const bodyInstruction = () => replacement().with[0];

test("rad-132-167 Heimerdinger: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("369.1"), true);
  assert.equal(program.judgeReason.includes("effect.token"), true);
  assert.equal(program.judgeReason.includes("RIFT-357"), true);
  assert.equal(
    program.sourceText,
    "If you would play a unit token to a location while I'm at a battlefield, you may play a 3 :rb_might: Mech unit token to that same location instead."
  );
});

test("rad-132-167 Heimerdinger: 369.1 的可选替代能力声明形状", () => {
  assert.equal(program.abilities.length, 1);
  const ability = replacement();
  assert.equal(ability.kind, "replacement");
  // "If you would play a unit token ... instead" → 替代的对象是打出衍生物的事件。
  assert.deepEqual(ability.replaces, { event: "card-played", object: { type: "token" } });
  // "while I'm at a battlefield" 用命名谓词表达（同 fiora-peerless 的既有先例）。
  assert.deepEqual(ability.condition, {
    kind: "expression",
    value: { kind: "constant", value: "source-at-a-battlefield" }
  });

  assert.equal(ability.with.length, 1);
  const instruction = bodyInstruction();
  assert.equal(instruction.id, "heimerdinger-academy-instructor.play-mech-instead");
  assert.equal(instruction.op, "effect.token");
  // 187.4 的 3 Might Mech 衍生物定义（不发明衍生物能力）。
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "mech" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // 440.2.c/185.2.a：被打出的衍生物先在链上创建再交付 play。
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  // "to that same location" 的占位：真实值是被替代打出动作的目的地，须由替代管线绑定。
  assert.deepEqual(instruction.args.location, {
    kind: "constant",
    value: { type: "battlefield", id: "replaced-play-location" }
  });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("rad-132-167 Heimerdinger: 替代体中的 effect.token 可创建 187.4 的 Mech（位置由替代管线提供）", () => {
  const kernel = world()
    .unit("heimerdinger", { location: BATTLEFIELD, might: 5 })
    .build();
  const instruction = bodyInstruction();
  // 替代的目标位置来自被替代的打出动作；参考内核里用该位置的实参验证 token 定义本身。
  const run = runInstruction(
    token,
    {
      token: instruction.args.token,
      amount: instruction.args.amount,
      mode: instruction.args.mode,
      location: { kind: "constant", value: BATTLEFIELD },
      linkKey: instruction.args.linkKey
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "Mech");
  assert.equal(created[0].might, 3);
  assert.deepEqual(created[0].tags, ["Mech"]);
  assert.deepEqual(created[0].location, BATTLEFIELD);
  assert.equal(created[0].energy, null);
  assert.equal(created[0].power, null);
  // 衍生物是被"打出"的：创建 + play 两个动作，打出事件落在 card-played 时点。
  assert.deepEqual(run.events.map(event => event.action), ["create-token", "play"]);
  assert.equal(run.events[1].timingPoint, "card-played");
  assert.equal(run.linked.replacementToken.amount, 1);
});

test("rad-132-167 Heimerdinger: 程序不把占位位置当成来源自身位置", () => {
  // 这条断言防止"用来源位置近似被替代动作的目的地"：来源在战场 bf1 时，
  // 替代体声明的占位常量与 bf1 不等，必须在替代管线里被绑定为被替代动作的位置。
  const instruction = bodyInstruction();
  assert.deepEqual(instruction.args.location.value, { type: "battlefield", id: "replaced-play-location" });
  assert.equal(instruction.args.location.value.id, "replaced-play-location");
});

test.todo(
  "rad-132-167 Heimerdinger: 369.1 的替代提交需要 replacement planner 支持 effect.token，" +
    "并保留 \"you may ... instead\" 的打出前可选询问"
);

test.todo(
  "rad-132-167 Heimerdinger: \"to that same location\" 的绑定——IR 没有\"被替代打出动作的目标位置\"" +
    "选择器，替代管线必须把被替代事件的 location 传进 effect.token；程序里的" +
    "replaced-play-location 是标注用的占位常量（RIFT-357）"
);
