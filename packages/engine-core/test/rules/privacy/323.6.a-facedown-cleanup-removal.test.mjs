// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-facedown-removed-on-cleanup-still-hidden-then-revealed (CR v1.5 323.6.a, 107.3.d, 422.4)
//
// 状态：test.todo。缺什么：清理移除失控战场上的面朝下牌。
//   * src/turn/flow.ts 的 cleanup 显式抛 TurnCombatBlockedError('hidden-cleanup-state')：
//     “Hidden cleanup needs an explicit Hidden state separate from faceDown”
//     （probe16 实测：带面朝下牌的 TurnFlow.start() 直接 blocked）。
//   * 也就是说清理到面朝下牌时引擎拒绝继续，无法产生 cleanup.started -> card.revealed ->
//     zone.enter(trash) 的序列，也无法断言 323.6.a/107.3.d 的目的地。
// 需要的机制：独立的 Hidden 状态与 323.6.a 清理移除路径（zones/ 与 turn/ 范围）。
import test from "node:test";
import assert from "node:assert/strict";
import { bindResolveContext, createActionPipelineHost } from "../../../dist/events/action-adapter.js";
import { world } from "../../../dist/effects/testing/test-kernel.js";
import { TurnFlow } from "../../../dist/turn/flow.js";
import { createHiddenState, hideCard } from "../../../dist/zones/hidden/index.js";

test("privacy-facedown-removed-on-cleanup-still-hidden-then-revealed", () => {
  const kernel = world().player('A').player('B')
    .base('source', { might: 4 }).deck(['A:d'], { owner: 'A' }).deck(['B:d'], { owner: 'B' })
    .rune(['A:r'], { owner: 'A' }).rune(['B:r'], { owner: 'B' })
    .hand('hidden', { keywords: [{ id: 'Hidden' }] }).build();
  const hidden = kernel.getObject('hidden');
  let state = createHiddenState([
    { battlefieldId: 'bf1', controller: 'A' },
    { battlefieldId: 'bf2', controller: null },
  ]);
  state = hideCard(state, { card: hidden, player: 'A', battlefieldId: 'bf1', openState: true }).state;
  kernel.addObject({ ...hidden, faceDown: true, zone: 'board', location: { type: 'battlefield', id: 'bf1' } }, 'board');
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error('cleanup requires no choice'); },
    context: (source, controller, timing) => bindResolveContext(kernel, { source, controller, timingPoint: timing }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const flow = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: [{ id: 'bf1', controller: 'B' }, { id: 'bf2', controller: null }], hiddenState: state,
  });
  flow.start();
  assert.equal(kernel.getObject('hidden').zone, 'trash');
  assert.equal(flow.hidden().zones.bf1.cards.length, 0);
});

