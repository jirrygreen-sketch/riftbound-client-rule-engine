// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-draw-not-revealed-to-opponent (event channel half, CR v1.5 414.1, 108.7.c)
//
// 状态：test.todo。缺什么：src/events 发出的抽牌事件把被抽的牌完整写进
// sourceCardId 与 simultaneousGroup，而 src/projection/v2 的事件投影只清洗
// object/source/target/objects/cardId/physicalCardId/card/name/objectId/instanceId/
// uid/ref 这些键，不认识这两个顶层字段。
// 实测（/tmp/RIFT-628-rules-tests-privacy/probe39.mjs，TurnFlow 真实 Draw 阶段）：
//   对手 B 的 card-drawn 事件得到 sourceCardId 'card:A-d2'、simultaneousGroup 'A-d2'，
//   即对手能从事件流直接读到 A 抽到的牌 —— 违反 108.7.c。
// 需要的机制：src/projection/v2/project-for.ts 的 safeEvent 把同时分组键改为与身份
// 无关的稳定 token（相邻事件同组即可），并在隐藏事件里剥掉 sourceCardId（或按与
// object 相同的可见性裁决）。属 projection 层其它任务范围。
import test from "node:test";

test.todo(
  "privacy-draw-not-revealed-to-opponent: 抽牌事件的 sourceCardId / simultaneousGroup 对非所有者不可见 " +
  "[M]（缺：safeEvent 未清洗这两个顶层字段，对手视角实测读到 card:A-d2）"
);
