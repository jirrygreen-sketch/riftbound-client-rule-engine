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

test.todo(
  "privacy-facedown-removed-on-cleanup-still-hidden-then-revealed: 清理移除失控战场的面朝下牌并在换区时公开 " +
  "[M]（缺：Hidden 状态与 323.6.a 清理路径；TurnFlow cleanup 当前抛 hidden-cleanup-state）"
);

