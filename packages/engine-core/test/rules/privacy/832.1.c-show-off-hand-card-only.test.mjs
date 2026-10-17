// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-show-off-hand-card-only-not-hand (CR v1.5 832.1.c, 832.1.b.1)
//   scenario: privacy-show-off-declined-nothing-leaked  (CR v1.5 832.1.c, 832.1.c.2)
//
// 状态：test.todo。缺什么：Show Off 的 Finalize 选择与展示管线。
//   * src/effects/keywords/ShowOff.ts 只产出静态 cost.reveal 声明，头注释列出未合入依赖：
//     cost.reveal 的 Finalize 选择/合法性管线、objects-shown-off 时点与快照消费者、
//     condition.result 的 per-instance 链接值。
//   * src 内没有任何 cost.reveal 消费者（grep 只命中 ShowOff.ts），所以既无法让控制者
//     选择展示哪张手牌，也无法产生“只展示 #s1、不展示 #s2”的 card.revealed 事件。
//   * 放弃（decline）分支同理没有对象——832.1.c.2 的“由链项控制者在 Finalize 决定”没有实现。
// 需要的机制：cost.reveal 的 Finalize 管线 + objects-shown-off 时点与快照（832.1.c-d.1）。
import test from "node:test";

test.todo(
  "privacy-show-off-hand-card-only-not-hand: Show Off 只展示被选中的那张手牌、其余手牌保持 Private " +
  "[M]（缺：cost.reveal 的 Finalize 选择管线与 objects-shown-off 展示时点）"
);

test.todo(
  "privacy-show-off-declined-nothing-leaked: 放弃 Show Off 时不产生任何 card.revealed 事件 " +
  "[M]（缺：832.1.c.2 的 Finalize 可选决定，ShowOff 展开无消费者）"
);

