import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/heimerdinger-academy-instructor.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { actionMatchesEventPattern } from "../../../../engine-core/dist/replacement/pattern.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { planReplacementBody } from "../../../../engine-core/dist/replacement/planner.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/bind.js";

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
  // Second-sweep refresh: the reason must name the concrete planner rejection and
  // the planner literal-array contract, not a vague "not yet supported".
  assert.match(program.judgeReason, /Unsupported replacement opcode/);
  assert.match(program.judgeReason, /REPLACED_EVENT_LINK/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /destination/);
  assert.match(program.judgeReason, /replacement\.event/);
  assert.match(program.judgeReason, /args\.instead/);
  assert.match(program.judgeReason, /ReplacementRegistration\.optional/);
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
  assert.deepEqual(ability.replaces, {
    event: "card-played",
    object: { type: "unit", controller: "self", characteristics: { isToken: true } }
  });
  // Bind the source identity before counting objects at battlefields.
  assert.deepEqual(ability.condition, {
    kind: "compare",
    left: {
      kind: "count", subject: "unit",
      filter: { object: "source", zone: "board", location: "battlefield" }
    },
    operator: "eq",
    right: { kind: "constant", value: 1 }
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
  assert.notDeepEqual(instruction.args.location.value, BATTLEFIELD);
  assert.deepEqual(instruction.args.location.value, { type: "battlefield", id: "replaced-play-location" });
  assert.equal(instruction.args.location.value.id, "replaced-play-location");
});

test("rad-132-167 Heimerdinger gap: the merged replacement planner still rejects effect.token (369.1 / 440.2.c)", () => {
  // The merged replacement planner is the only path that turns a replacement
  // body into committable GameActions; it rejects the token op that this card
  // needs to create the Mech on the Chain and hand it to play.
  const planInput = { hostRef: { id: "heimerdinger", zoneEntryId: 1 }, replacedObject: null, usedWindow: false };
  const planner = {
    hostRef: planInput.hostRef,
    replacedObject: null,
    usedWindow: false,
    host: { object: () => null, objects: () => [], context: () => { throw new Error("unused"); } },
    controller: "A",
    evaluate: (expr) => (expr && typeof expr === "object" && "value" in expr ? expr.value : expr)
  };
  assert.throws(
    () => planReplacementBody(bodyInstruction() ? [bodyInstruction()] : [], planInput, planner),
    /Unsupported replacement opcode: effect\.token/
  );
});

test("rad-132-167 Heimerdinger gap: bindReplacement rejects the same body at bind time", () => {
  // The production binder validates each non-wrapper instruction through the same
  // planner, so the card's replacement cannot even be registered today.
  const kernel = world()
    .unit("heimerdinger", { types: ["unit"], might: 5, location: BATTLEFIELD, controller: "A", owner: "A" })
    .build();
  assert.throws(
    () => bindReplacement(replacement(), kernel.ref("heimerdinger"), {
      host: {
        object: (ref) => kernel.getObject(ref.id),
        objects: () => kernel.query({}),
        context: (snapshot, controller) => kernel.clone({ sourceSnapshot: snapshot, controller })
      },
      pipeline: { clock: { turn: 1 }, registerReplacement: () => {} }
    }),
    /Unsupported replacement opcode: effect\.token/
  );
});

test("rad-132-167 Heimerdinger gap: the optional `instead` wrapper cannot be written into instruction.args", () => {
  // bindReplacement accepts only a literal array for `instead`, while the IR
  // requires every instruction arg to be an Expr, so the "you may ... instead"
  // decision has no honest declaration shape yet. Both halves are asserted here.
  const wrapped = {
    canonicalCardId: CANONICAL,
    rulesetVersion: "core-1.5",
    status: "judge-required",
    judgeReason: "optional wrapper shape probe",
    sourceText: program.sourceText,
    abilities: [{
      kind: "replacement",
      replaces: replacement().replaces,
      with: [{
        id: "heimerdinger-academy-instructor.play-mech-instead",
        op: "replacement.event",
        args: {
          event: { kind: "constant", value: { event: "card-played" } },
          optional: { kind: "constant", value: true },
          instead: [bodyInstruction()]
        }
      }]
    }]
  };
  const result = validateCardProgram(wrapped);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((issue) => [issue.path, issue.code]),
    [["$.abilities[0].with[0].args.instead", "invalid-expression"]]
  );
});

test("rad-132-167 Heimerdinger gap: a direct `with` replacement carries no optional flag", () => {
  // The card's declared direct shape binds without an optional declaration, so
  // the printed "you may" would be silently mandatory.
  const kernel = world()
    .unit("heimerdinger", { types: ["unit"], might: 5, location: BATTLEFIELD, controller: "A", owner: "A" })
    .unit("target", { types: ["unit"], controller: "A", owner: "A" })
    .build();
  const bound = bindReplacement({
    replaces: replacement().replaces,
    with: [{
      id: "probe.draw",
      op: "effect.draw",
      args: { amount: { kind: "constant", value: 1 }, target: { kind: "constant", value: "A" } }
    }],
    condition: replacement().condition
  }, kernel.ref("heimerdinger"), {
    host: {
      object: (ref) => kernel.getObject(ref.id),
      objects: () => kernel.query({}),
      context: (snapshot, controller) => kernel.clone({ sourceSnapshot: snapshot, controller })
    },
    pipeline: { clock: { turn: 1 }, registerReplacement: () => {} }
  });
  assert.equal(bound.registration.optional, undefined);
  assert.equal(bound.registration.oncePerTurn, undefined);
});

test.todo(
  "rad-132-167 Heimerdinger: 369.1 的替代提交需要 replacement planner 支持 effect.token，" +
    "并保留 \"you may ... instead\" 的打出前可选询问（当前 planner 抛 Unsupported replacement opcode；" +
    "args.instead 只接受字面量数组，与 Expr 契约冲突）"
);

test.todo(
  "rad-132-167 Heimerdinger: \"to that same location\" 的绑定——IR 没有\"被替代打出动作的目标位置\"" +
    "选择器（替代输入只暴露 replacement.object），替代管线必须把被替代 play 动作的 location 传进 effect.token；" +
    "程序里的 replaced-play-location 是标注用的占位常量；已合入的对象位置选择器不代表 play 动作的目的地"
);


for (const [name, zone, location, expected] of [
  ["battlefield", "board", BATTLEFIELD, true],
  ["base beside another battlefield unit", "board", { type: "base", player: "A" }, false],
  ["hand", "hand", null, false]
]) test(`Heimerdinger: the source battlefield condition is ${expected} in ${name}`, () => {
  const kernel = world()
    .unit("heimerdinger", { cardId: CANONICAL, zone, location, might: 5 })
    .unit("unrelated", { location: BATTLEFIELD, might: 3 }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("heimerdinger") });
  const layers = createLayerEngine(kernel.objects);
  const actual = evaluateCondition(replacement().condition, {
    context,
    query: filter => layers.evaluateAll().filter(object => matchesObjectFilter(filter, object)),
    linked: key => context.linked(key),
    canLookBack: () => false,
    isIgnored: () => false
  });
  assert.equal(actual, expected);
});

for (const [name, types, isToken, controller, expected] of [
  ["friendly unit token", ["unit"], true, "A", true],
  ["friendly unit card", ["unit"], false, "A", false],
  ["enemy unit token", ["unit"], true, "B", false],
  ["friendly gear token", ["gear"], true, "A", false]
]) test(`Heimerdinger: the replacement event matches ${name}: ${expected}`, () => {
  const kernel = world().player("B")
    .unit("heimerdinger", { location: BATTLEFIELD, might: 5 })
    .card("played", { zone: "chain", owner: controller, controller, types, isToken }).build();
  const object = kernel.ref("played");
  const action = { type: "play", object, player: controller, location: BATTLEFIELD };
  assert.equal(actionMatchesEventPattern({
    pattern: replacement().replaces, action, target: { object, player: controller },
    hostRef: kernel.ref("heimerdinger"), controller: "A",
    snapshotFor: ref => kernel.object(ref)
  }), expected);
});
