// RIFT-277 golden test — scenario `layers-inactive-text-loses-timestamp`（edge）
//
// 状态：test.todo。缺什么：规则文本 Inactive/恢复的时间戳生命周期。
// 现状（实测 /tmp/RIFT-277-rules-tests-layers/probe5.mjs 17）：
//   `ContinuousEffectRegistry.register` 的 timestamp 默认取注册序号，重新注册确实拿到更晚的
//   时间戳（17 号探针实测：重新注册的 aura timestamp 3 > later 的 2）；但 Inactive 的对象
//   状态机（文本失活、何时移除、何时恢复、恢复时重新注册）在 layers 层没有任何入口：
//   `src/layers/` 内的 `expireInactive` 只处理 `while-source-in-zone` 的源离场，
//   `removeContinuous` 只有调用方显式删除，没有任何 Inactive 状态驱动。
//   YAML 场景本身也标了 UNCERTAIN（两种顺序终值相同，只能验证机制是否建模）。
// 需要的机制：Inactive 状态 → 效果移除/恢复 → 重新建立时间戳的驱动；属 `src/layers/`
// 与 zones/permanent-state 的接线，不在本任务写入范围。
import test from "node:test";

test.todo("layers-inactive-text-loses-timestamp: 规则文本转为 Inactive 丢失时间戳、恢复时按新时间戳排队（缺：Inactive 驱动）");
