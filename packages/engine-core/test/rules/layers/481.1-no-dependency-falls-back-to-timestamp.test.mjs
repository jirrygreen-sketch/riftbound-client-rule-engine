// RIFT-277 golden test — scenario `layers-no-dependency-falls-back-to-timestamp`（edge）
//
// 状态：test.todo。缺什么：同层“无法确立依赖时退回时间戳”的逐个施加顺序。
// 现状（实测 /tmp/RIFT-277-rules-tests-layers/probe11.mjs）：
//   算术层的所有增加量在施加前统一求值再相加，两个互相影响的效果实测恒为 6，
//   官方 481.1 的例是 5（先施加早时间戳的被动 +1，后到的“最高 5”法术再施加得 +0）。
//   没有 481.1 的“双向被改变 → 不建立依赖”判定，也没有 482.3 的按时间戳逐个施加。
// 需要的机制：效果依赖判定 + 时间戳逐个施加；属 `src/layers/` 语义扩展。
import test from "node:test";

test.todo("layers-no-dependency-falls-back-to-timestamp: 无依赖时按时间戳逐个施加（缺：481.1 判定与 482.3 顺序）");
