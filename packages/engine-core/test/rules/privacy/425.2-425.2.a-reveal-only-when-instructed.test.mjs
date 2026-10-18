// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-reveal-only-when-instructed (CR v1.5 425.2, 425.2.a)
//
// 状态：test.todo（命令层缺失）。缺什么：新内核没有“玩家主动提交 Reveal 命令”的入口，
// 也没有 425.2.a 的 Limited Action 拒绝面。
//   * src/effects/contract.ts 的 GameAction 有 reveal，但没有命令/准入层把它限制为
//     “仅由效果指示”；reference kernel 的 perform({type:'reveal'}) 是内核内部调用，
//     不是玩家命令。
//   * src/projection/v2 只负责投影，不能表达“该命令被拒”。
//   * 已合入的等价可执行断言见下面第二个测试：TurnFlow 的 Draw 阶段没有任何
//     card-revealed 事件（414.1）。
// 需要的机制：chain/ 或 game/ 的玩家命令准入（拒绝码 reveal-not-instructed）。
import assert from "node:assert/strict";
import test from "node:test";
import { bindResolveContext, createActionPipelineHost, timings, world } from "./harness.mjs";
import { TurnFlow } from "../../../dist/turn/flow.js";

test.todo(
  "privacy-reveal-only-when-instructed: 玩家主动提交的 reveal 命令被拒且不产生 card.revealed 事件 " +
  "[M]（缺：玩家命令准入层，新内核没有 Limited Action 的命令入口）"
);

test("privacy-reveal-only-when-instructed: no card is revealed without an effect instructing it", () => {
  const kernel = world().player("A").player("B").build();
  for (const player of ["A", "B"]) {
    for (const id of [player + "-d1", player + "-r1"]) {
      const rune = id.endsWith("-r1");
      kernel.addObject({
        ref: { id, zoneEntryId: 1 }, cardId: "card:" + id, name: id, types: [rune ? "rune" : "unit"],
        tags: [], keywords: [], owner: player, controller: player, zone: rune ? "rune-deck" : "deck",
        location: null, might: rune ? null : 1, energy: null, power: null, exhausted: false,
        damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
      }, rune ? "rune-deck" : "deck");
    }
  }
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("the Draw phase makes no choices"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => false
  });
  const flow = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }]
  });
  flow.start();
  assert.equal(kernel.player("A").handCount, 1, "the Draw phase really drew a card");
  assert.equal(timings(flow.chain).includes("card-revealed"), false, "414.1: drawing is not revealing");
});

