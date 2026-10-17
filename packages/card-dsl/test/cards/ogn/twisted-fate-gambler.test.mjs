import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/twisted-fate-gambler.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-6d4a83a454e91140b5cccaf25cef83d38b553d0863d8f7c80b8719fe33d8475e";
const SOURCE_TEXT =
  "When I attack, reveal the top rune of your rune deck, then recycle it. Do one of the " +
  "following based on its domain:\n" +
  ":rb_rune_fury: — Deal 2 to an enemy unit here and 1 to all other enemy units here." +
  ":rb_rune_mind: — Draw 1." +
  ":rb_rune_order: — Stun an enemy unit.";

const [triggered] = program.abilities;
const [reveal, recycle, fury, mind, order] = triggered.body;
const [deal2, deal1] = fury.args.body.value;
const [draw1] = mind.args.body.value;
const [stun1] = order.args.body.value;

/** 把 IR 里的目标声明剥离，模拟 Finalize 已经锁定目标后的解释器调用。 */
function withLockedTargets(body) {
  return body.map(({ targets, ...rest }) => rest);
}

function attackWorld(rune, domain) {
  const base = world()
    .rune([rune], { power: [domain] })
    .deck("deck-1")
    .unit("tf", { location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-a", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-b", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-far", { owner: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("tf") });
}

test("twisted-fate-gambler: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("twisted-fate-gambler: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /388/);
  assert.match(program.judgeReason, /ordered-pick/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("twisted-fate-gambler: attack trigger and the reveal → recycle → branch body", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  // CR 383.4.e: “When I attack” 是攻击触发；时点 attack-declared。
  assert.equal(triggered.trigger.at, "attack-declared");
  assert.deepEqual(triggered.trigger.filter, {
    event: "attack-declared",
    object: { objectId: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);
  assert.deepEqual(
    triggered.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["twisted-fate-gambler.reveal-rune", "effect.reveal"],
      ["twisted-fate-gambler.recycle-rune", "effect.recycle"],
      ["twisted-fate-gambler.fury", "sequence"],
      ["twisted-fate-gambler.mind", "sequence"],
      ["twisted-fate-gambler.order", "sequence"]
    ]
  );
});

test("twisted-fate-gambler: the top rune is revealed, then recycled from the linked result", () => {
  // CR 425.1 / 425.3.a: 展示 1 张符文；108.5.d 说明符文牌库顺序是秘密信息。
  assert.equal(reveal.op, "effect.reveal");
  assert.deepEqual(reveal.args.zone, { kind: "constant", value: "rune-deck" });
  assert.deepEqual(reveal.args.count, { kind: "constant", value: 1 });
  assert.equal(reveal.targets, undefined);

  // CR 417.1.b / 417.1.c: 符文回收进符文牌库（牌主自己的）。
  assert.equal(recycle.op, "effect.recycle");
  assert.equal(recycle.linkedTo, "twisted-fate-gambler.reveal-rune");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked-value",
    instructionId: "twisted-fate-gambler.reveal-rune",
    key: "revealed"
  });
});

test("twisted-fate-gambler: each branch is guarded by the revealed rune's domain", () => {
  for (const [instruction, domain] of [[fury, "Fury"], [mind, "Mind"], [order, "Order"]]) {
    const condition = instruction.condition;
    assert.equal(condition.kind, "compare");
    // 域用被展示符文的 power 列表（契约 3.6 的 linked 选择器）。
    assert.deepEqual(condition.left, {
      kind: "object-property",
      object: { linked: "twisted-fate-gambler.reveal-rune" },
      property: "power"
    });
    assert.equal(condition.operator, "eq");
    assert.deepEqual(condition.right, { kind: "constant", value: [domain] });
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("twisted-fate-gambler: the Fury branch deals 2 here and 1 to the other enemy units here", () => {
  assert.deepEqual(deal2.args.amount, { kind: "constant", value: 2 });
  assert.equal(deal2.targets.length, 1);
  assert.deepEqual(deal2.targets[0].filter, {
    type: "unit",
    controller: "opponent",
    sameLocationAs: "self"
  });
  assert.equal(deal2.targets[0].selection, "one");

  assert.deepEqual(deal1.args.amount, { kind: "constant", value: 1 });
  // CR 355.14 / 契约 3.6: “all other enemy units here” 用 exclude 排除被选中的那一个。
  assert.deepEqual(deal1.targets[0].filter, {
    type: "unit",
    controller: "opponent",
    sameLocationAs: "self",
    exclude: { target: "enemy-unit-here" }
  });
  assert.equal(deal1.targets[0].selection, "all");
  assert.equal(deal1.targets[0].min, 0);
  assert.equal(deal1.linkedTo, "twisted-fate-gambler.deal-2");
});

test("twisted-fate-gambler: the Mind branch draws 1 and the Order branch stuns an enemy unit", () => {
  assert.equal(draw1.op, "effect.draw");
  assert.deepEqual(draw1.args.amount, { kind: "constant", value: 1 });
  assert.equal(draw1.targets, undefined);

  assert.equal(stun1.op, "effect.stun");
  assert.deepEqual(stun1.args.target, { kind: "constant", value: "enemy-unit" });
  assert.deepEqual(stun1.targets[0].filter, { type: "unit", controller: "opponent" });
  assert.equal(stun1.targets[0].selection, "one");
});

test("twisted-fate-gambler golden: reveal + recycle move the top rune to the bottom of the rune deck", () => {
  const kernel = attackWorld("fury-rune", "Fury");

  const outcome = resolveChainBody([reveal, recycle], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["twisted-fate-gambler.reveal-rune", "executed"],
    ["twisted-fate-gambler.recycle-rune", "executed"]
  ]);
  // 417.1.b: 回收进符文牌库；单张符文回收后仍在符文牌库。
  assert.deepEqual(kernel.zone("A", "rune-deck").map((ref) => ref.id), ["fury-rune"]);
  assert.equal(outcome.linkedValues["twisted-fate-gambler.recycle-rune.recycledCount"], 1);
});

test("twisted-fate-gambler golden: the domain read yields the revealed rune's power list", () => {
  for (const [rune, domain] of [["fury-rune", "Fury"], ["mind-rune", "Mind"], ["order-rune", "Order"]]) {
    const kernel = attackWorld(rune, domain);
    const outcome = resolveChainBody(
      [
        reveal,
        {
          id: "twisted-fate-gambler.domain",
          op: "condition.value",
          linkedTo: "twisted-fate-gambler.reveal-rune",
          args: {
            value: {
              kind: "object-property",
              object: { linked: "twisted-fate-gambler.reveal-rune" },
              property: "power"
            },
            key: { kind: "constant", value: "domain" }
          }
        }
      ],
      kernel
    );
    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.linkedValues["twisted-fate-gambler.domain.domain"], [domain]);
  }
});

test("twisted-fate-gambler golden: the Fury branch deals 2 + 1 at the attacker's battlefield", () => {
  const kernel = attackWorld("fury-rune", "Fury");
  kernel.setTargets("enemy-unit-here", [kernel.ref("enemy-a")]);
  kernel.setTargets("other-enemy-units-here", [kernel.ref("enemy-b")]);

  // 走生产链适配器：它负责把 IR 的 Expr 参数解码给原语 schema（契约 3.2 的调用约定）。
  const outcome = resolveChainBody(withLockedTargets(fury.args.body.value), kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["twisted-fate-gambler.deal-2", "executed"],
    ["twisted-fate-gambler.deal-1-to-others", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy-a").damage, 2);
  assert.equal(kernel.getObject("enemy-b").damage, 1);
  // 另一个战场上的敌人不受影响（“here”）。
  assert.equal(kernel.getObject("enemy-far").damage, 0);
});

test("twisted-fate-gambler golden: the Fury branch's second instruction follows the first (359.3.e.14.a)", () => {
  const kernel = attackWorld("fury-rune", "Fury");
  const lockedA = kernel.ref("enemy-a");
  kernel.setTargets("enemy-unit-here", [lockedA]);
  kernel.setTargets("other-enemy-units-here", [kernel.ref("enemy-b")]);
  kernel.perform({ type: "kill", object: lockedA });

  const outcome = resolveChainBody(withLockedTargets(fury.args.body.value), kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[1].result.status, "ignored");
  assert.equal(outcome.results[1].result.reason, "linked-ignored");
  assert.equal(kernel.getObject("enemy-b").damage, 0);
});

test("twisted-fate-gambler golden: the Mind branch draws 1 (CR 414.3)", () => {
  const kernel = attackWorld("mind-rune", "Mind");
  // 先用真实 reveal + domain 读取建链，再用程序里的 Mind 分支执行
  const outcome = resolveChainBody(
    [
      { ...reveal, id: "twisted-fate-gambler.reveal-rune" },
      {
        id: "twisted-fate-gambler.domain",
        op: "condition.value",
        linkedTo: "twisted-fate-gambler.reveal-rune",
        args: {
          value: {
            kind: "object-property",
            object: { linked: "twisted-fate-gambler.reveal-rune" },
            property: "power"
          },
          key: { kind: "constant", value: "domain" }
        }
      },
      mind
    ],
    kernel
  );
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["twisted-fate-gambler.reveal-rune", "executed"],
    ["twisted-fate-gambler.domain", "executed"],
    ["twisted-fate-gambler.draw-1", "executed"],
    ["twisted-fate-gambler.mind", "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["deck-1"]);
  assert.equal(outcome.linkedValues["twisted-fate-gambler.mind/twisted-fate-gambler.draw-1.drawn"], 1);
});

test("twisted-fate-gambler golden: the Order branch stuns an enemy unit (CR 424.1)", () => {
  // The interpreter reads the Finalize-locked targets; the golden supplies that
  // lock through setTargets and runs the card's own stun instruction through
  // runAbilityBody (the chain-adapter decoding gap is recorded in judgeReason
  // and the todo below).
  const kernel = attackWorld("order-rune", "Order");
  kernel.setTargets("enemy-unit", [kernel.ref("enemy-far")]);

  const outcome = runAbilityBody(withLockedTargets([stun1]), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["twisted-fate-gambler.stun-1", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy-far").stunned, true);
  assert.deepEqual(outcome.events.map((event) => event.action), ["stun"]);
  assert.equal(stun1.args.target.value, "enemy-unit");
});

test.todo(
  "twisted-fate-gambler: 反身触发（388.1.b “Do one of the following”）要求按域条件把选中的分支作为**新的链项**" +
    "入链；没有卡牌可用的反身触发构造原语，且 chain/engine.ts 的 assertFinalizationSurface 拒绝 choice.mode" +
    "（Mode choices require a Finalize/Resolve choice-plan adapter）"
);

test.todo(
  "twisted-fate-gambler: “reveal the top rune of your rune deck” 的顶张顺序（108.5.d）依赖把 zoneSlice/ordered picks" +
    "接进 effect.reveal 的区域真子集路径（当前对符文牌库取顶 1 张会抛 “a subset of this zone requires upstream ordered picks”）"
);

test.todo(
  "twisted-fate-gambler: 经链式适配器执行 effect.stun 需要 chain/interpreter-adapter.ts 的 LITERAL_FIELDS 支持 IR 里 target" +
    "的目标 id 解码（当前会抛 “effect.stun target must be a spec id string”）；修复后再断言 Order 分支走链路径"
);
