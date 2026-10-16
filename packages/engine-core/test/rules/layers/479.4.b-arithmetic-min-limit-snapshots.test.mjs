// RIFT-277 golden test — scenario `layers-arithmetic-min-limit-snapshots`
//
// 状态：test.todo。缺什么：算术层没有“限制随效果快照”的语义参数。
// 现状（实测 /tmp/RIFT-277-rules-tests-layers/probe7.mjs、(j)）：
//   * `ContinuousEffectSpec.effect` 只接受 kind/value/amount 等自由字段，没有 min/max/limit；
//     `applyArithmetic` 也不读取任何限制，只有全局的 `might < 0 → 0` 兜底。
//   * 因此无法表达“-4 [M] 最低 1 → 记住 -1”，也无法区分它与无限制的 -4。
// 需要的机制：算术效果的限制字段（min/max）+ 施加时快照（479.4.b / 479.4.e.2.b），
// 属 `src/layers/` 语义扩展与契约变更，不在本任务写入范围。
import test from "node:test";

test.todo("layers-arithmetic-min-limit-snapshots: 非被动效果的限制在施加时快照为 -1（缺：算术层 min 限制与快照）");
