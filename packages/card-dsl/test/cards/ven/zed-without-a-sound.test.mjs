import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/zed-without-a-sound.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateInstructionTargets, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";

const CANONICAL_ID =
  "card.hash-5b42742bf383c1d6c7809e387ff198cfe26b37f06ef74cd7742bf390ea3cf2a7";
const SOURCE_TEXT =
  'When I conquer, play a 0 :rb_might: Shadow Clone unit token to your base. (It has "When I attack, ' +
  'you may banish a unit from your trash. If you do, give me [Assault 4] this turn.")\n' +
  "[Action][>] :rb_energy_1::rb_rune_chaos:: Move me and a Shadow Clone you control to each other's locations.";

const [conquer, activated] = program.abilities;
const [baseLocation, playClone] = conquer.body;
const [origin, cloneLocation, moveMe, moveClone] = activated.body;

/** 静态 IR 的 targets 由 Finalize 锁定；参考内核用 setTargets 提供同样的锁定结果。 */
const withoutTargets = (body) => body.map(({ targets, ...rest }) => rest);

test("ven-112-166 Zed, Without a Sound: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-112-166 Zed: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 仅缺 token 定义与 conquer 来源对象载荷（见 judgeReason）。
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /player\/details/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(89|90|91|120|257)/);
});

test("ven-112-166 Zed: the conquer trigger plays a Shadow Clone token to your base", () => {
  // 383.4.c.1 / 473.2.a："When I conquer" 是 Conquer Effect，指向能力来源自身。
  assert.equal(conquer.kind, "triggered");
  assert.equal(conquer.trigger.at, "conquer");
  assert.deepEqual(conquer.trigger.filter, { event: "conquered", filter: { source: "self" } });
  assert.equal(conquer.optional, false);

  assert.equal(program.abilities.length, 2);
  assert.equal(conquer.body.length, 2);
  // "to your base" resolves through the merged relative LocationExpr and is
  // frozen before the token instruction consumes it as a linked value.
  assert.equal(baseLocation.id, "zed-without-a-sound.base-location");
  assert.equal(baseLocation.op, "condition.value");
  assert.deepEqual(baseLocation.args.value, { kind: "location", value: "ability-controller-base" });
  assert.equal(playClone.id, "zed-without-a-sound.play-shadow-clone");
  assert.equal(playClone.op, "effect.token");
  assert.deepEqual(playClone.args.token, { kind: "constant", value: "shadow-clone" });
  assert.deepEqual(playClone.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a：被“打出”的新 token 先在链上创建，再由 play 接手。
  assert.deepEqual(playClone.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playClone.args.location, {
    kind: "linked-value",
    instructionId: "zed-without-a-sound.base-location",
    key: "value"
  });
  assert.equal(playClone.linkedTo, "zed-without-a-sound.base-location");
  assert.equal(playClone.targets, undefined);
});

test("ven-112-166 Zed: the conquered EventPattern spelling binds through the production trigger adapter", () => {
  const translated = translateTriggerFilter(conquer.trigger.filter, "zed", conquer.trigger.at);
  assert.deepEqual(translated, { event: "conquered", object: { objectId: "zed" } });
  assert.doesNotThrow(() => assertTriggerSpec({ at: conquer.trigger.at, filter: translated }));
});

test("ven-112-166 Zed golden: the base LocationExpr resolves to the ability controller and the token path is still refused", () => {
  // Executed evidence for judgeReason point 1: the rewritten "to your base"
  // destination really resolves to a PlayerId Base (RIFT-357 path), and the
  // body then reaches the frozen token-definition table and is refused with the
  // exact blocked reason rather than a malformed destination.
  const kernel = world().player("A").build();
  const outcome = resolveChainBody(conquer.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]), [
    ["zed-without-a-sound.base-location", "executed", undefined],
    ["zed-without-a-sound.play-shadow-clone", "negated", "impossible"]
  ]);
  assert.deepEqual(outcome.linkedValues["zed-without-a-sound.base-location.value"], {
    type: "base",
    player: "A"
  });
  assert.equal(
    outcome.linkedValues["zed-without-a-sound.play-shadow-clone.token"].blockedReason,
    "token-definition-or-abilities-judge-required"
  );
  assert.equal(kernel.objects.some((object) => object.name === "Shadow Clone"), false);
});

test("ven-112-166 Zed golden: the conquer self anchor rejects the real scoring payload", () => {
  // Executed evidence for judgeReason point 2: turn/flow.ts's conquer emission
  // carries player + details.battlefieldId only; the translated source: "self"
  // anchor matches once (and only once) an object is present.
  const pattern = translateTriggerFilter(conquer.trigger.filter, "zed-instance", conquer.trigger.at);
  const event = {
    type: "task-resolved", seq: 1, eventId: 1, turnNumber: 1, activePlayerId: "A",
    taskId: "pipeline:1", sourceCardId: "", reason: "conquer", autoResolved: true,
    timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" }
  };
  assert.deepEqual(pattern, { event: "conquered", object: { objectId: "zed-instance" } });
  assert.equal(matchesTriggerEvent(pattern, event, "A"), false);
  assert.equal(
    matchesTriggerEvent(pattern, { ...event, object: { ref: { id: "zed-instance", zoneEntryId: 1 } } }, "A"),
    true
  );
});

test("ven-112-166 Zed: [Action][>] cost and the two locked swaps of the exchange body", () => {
  assert.equal(activated.kind, "activated");
  // 806.1.d：能力级 [Action] 许可记在 activated.timing。
  assert.equal(activated.timing, "action");
  // :rb_energy_1: 是 1 Energy，:rb_rune_chaos: 是 1 枚 Chaos Power（163.2）。
  assert.deepEqual(activated.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: ["Chaos"] }
  });

  assert.deepEqual(
    activated.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["zed-without-a-sound.origin", "condition.value"],
      ["zed-without-a-sound.clone-location", "condition.value"],
      ["zed-without-a-sound.move-me", "effect.move"],
      ["zed-without-a-sound.move-clone", "effect.move"]
    ]
  );

  // 355.4 / 448.3：两处原始位置都必须在第一次移动前锁定。
  assert.deepEqual(origin.args.value, {
    kind: "object-property",
    object: "self",
    property: "location"
  });
  assert.equal(origin.targets, undefined);
  assert.deepEqual(cloneLocation.args.value, {
    kind: "object-property",
    object: { target: "zed-without-a-sound.clone" },
    property: "location"
  });

  // "a Shadow Clone you control"：玩家选定的游戏对象（355.7/355.9.a），印刷名用
  // characteristics.name 记录；程序绑定会把 controller: "controller" 归一化为 self。
  assert.deepEqual(cloneLocation.targets, [
    {
      id: "zed-without-a-sound.clone",
      filter: {
        type: "unit",
        zone: "board",
        controller: "controller",
        characteristics: { name: "Shadow Clone" }
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.deepEqual(moveClone.targets, cloneLocation.targets);

  // 两次 Move 读链接值作为目的地：我的目的地是克隆的原始位置，克隆的目的地是我的。
  assert.deepEqual(moveMe.args.objects, { kind: "constant", value: "self" });
  assert.deepEqual(moveMe.args.to, {
    kind: "linked-value",
    instructionId: "zed-without-a-sound.clone-location",
    key: "cloneLocation"
  });
  assert.equal(moveMe.targets, undefined);
  assert.deepEqual(moveClone.args.objects, {
    kind: "constant",
    value: { target: "zed-without-a-sound.clone" }
  });
  assert.deepEqual(moveClone.args.to, {
    kind: "linked-value",
    instructionId: "zed-without-a-sound.origin",
    key: "origin"
  });
  const translatedBody = translateInstructionTargets(activated.body);
  assert.equal(translatedBody[1].targets[0].filter.controller, "self");
});

test("ven-112-166 Zed golden: the activated Energy plus Chaos Power cost is paid by the cost pipeline", () => {
  const kernel = world()
    .player("A", { energy: 2, power: ["Chaos"] })
    .unit("zed", { controller: "A", location: { type: "base", player: "A" } })
    .build();
  const plan = buildCostPlan(kernel, {
    id: "cost:zed-without-a-sound",
    cost: activated.cost
  });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Chaos"] }]);

  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(receipt.power.power, [{ requirementIndex: 0, from: "Chaos", amount: 1 }]);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay"]);
});

test("ven-112-166 Zed golden: the exchange swaps Zed and a Shadow Clone", () => {
  // 355.4 / 448.3（CR 448.1 的 Move）：交换必须基于“移动前”的两处位置。
  const base = world()
    .player("controller")
    .unit("zed", {
      controller: "controller",
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("clone", {
      controller: "controller",
      location: { type: "battlefield", id: "bf-2" },
      isToken: true,
      name: "Shadow Clone",
      might: 0
    })
    .build();
  const kernel = base.clone({
    controller: "controller",
    sourceSnapshot: base.getObject("zed")
  });
  kernel.setTargets("zed-without-a-sound.clone", [kernel.ref("clone")]);

  const outcome = resolveChainBody(withoutTargets(activated.body), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["zed-without-a-sound.origin", "executed"],
      ["zed-without-a-sound.clone-location", "executed"],
      ["zed-without-a-sound.move-me", "executed"],
      ["zed-without-a-sound.move-clone", "executed"]
    ]
  );
  assert.deepEqual(kernel.getObject("zed").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(kernel.getObject("clone").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(
    kernel.events.filter((event) => event.action === "move-location").length,
    2
  );
  // 两次移动各自写入链接收据，移动数各为 1。
  assert.equal(outcome.linkedValues["zed-without-a-sound.move-me.movedMe"].count, 1);
  assert.equal(outcome.linkedValues["zed-without-a-sound.move-clone.movedClone"].count, 1);
});

test("ven-112-166 Zed golden: a stale Shadow Clone target ignores only the clone half", () => {
  // 359.3.e.7 / 359.3.e.11：目标在结算时全部失效 → 该指令 ignored，后续仍尽可能执行。
  const base = world()
    .player("controller")
    .unit("zed", {
      controller: "controller",
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("clone", {
      controller: "controller",
      location: { type: "battlefield", id: "bf-2" },
      isToken: true,
      name: "Shadow Clone"
    })
    .build();
  const stale = base.ref("clone");
  base.perform({ type: "kill", object: stale });
  const kernel = base.clone({
    controller: "controller",
    sourceSnapshot: base.getObject("zed")
  });
  kernel.setTargets("zed-without-a-sound.clone", [stale]);

  const outcome = resolveChainBody(withoutTargets(activated.body), kernel);

  assert.equal(outcome.status, "partial");
  const cloneHalf = outcome.results.find(
    (entry) => entry.id === "zed-without-a-sound.clone-location"
  );
  assert.deepEqual(cloneHalf.result, { status: "ignored", reason: "mistargeted" });
  // 我的位置仍未变动（第一条移动的目的地不可用 → 不移动）。
  assert.deepEqual(kernel.getObject("zed").location, { type: "battlefield", id: "bf-1" });
});

test.todo(
  "ven-112-166 Zed: the Shadow Clone definition (a 0-Might unit token with its own attack trigger: " +
    "banish a unit from your trash, then [Assault 4]) plus chain creation / play hand-off — the frozen " +
    "effect.token DEFINITIONS table only holds token definitions with no extra abilities, so the " +
    "program keeps effect.token mode \"play\" as declared-but-not-executable (CR 187/440.2.c, 185.2.a)"
);

test.todo(
  "ven-112-166 Zed: the conquer trigger needs the scoring emission to carry the conquering unit object " +
    "so the source:self filter can match the actual unit (383.4.c.2.a / 473.2.a)"
);
