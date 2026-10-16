// RIFT-277 golden test — scenario `layers-showoff-locks-might-at-finalization`
//
// 状态：test.todo。缺什么：Show Off 的 Finalize 选择与快照消费者。
// 现状（实测 /tmp/RIFT-277-rules-tests-layers/probe3.mjs D）：
//   `effects/keywords/ShowOff.ts` 的展开只产出静态 `cost.reveal` 声明；自定义头注释列出的
//   依赖仍未合入：Finalize 的 reveal/pick 选择管线、`objects-shown-off` 时点的链值/快照
//   消费者、`condition.result` 的 per-instance 链接值。src 内没有任何 `cost.reveal`
//   消费者（`grep -rl 'cost.reveal' packages/engine-core/src` 只命中 ShowOff.ts）。
// 需要的机制：cost.reveal 的 Finalize 管线 + 展示时快照锁定（832.1.c–d.1）；属
// chain/cost 与关键词接线的其它任务范围，不在本任务写入范围。
import test from "node:test";

test.todo("layers-showoff-locks-might-at-finalization: 展示在 Finalize 锁定 [M]，之后被减 [M] 不影响伤害（缺：cost.reveal 管线与展示快照）");
