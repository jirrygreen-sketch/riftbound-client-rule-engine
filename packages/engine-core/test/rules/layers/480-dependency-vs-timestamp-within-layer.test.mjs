// RIFT-277 golden test — scenario `layers-dependency-vs-timestamp-within-layer`
//
// 状态：test.todo。缺什么：同层内“依赖压过时间戳”的判定。
// 现状（实测 /tmp/RIFT-277-rules-tests-layers/probe11.mjs）：
//   `applyArithmetic` 先一次性收集所有增加量（在施加任何增加之前求值 amount），
//   再统一相加。被动“升至 5”（5 - 当前值）与 Discipline +2 同时存在时，实测恒为 7，
//   官方 481 / 481.2 的例是 6（先施加 Discipline 的 +2，被动贡献 +0）。
//   engine 里没有 480.1.a-c 的依赖判定，也没有 481.2 的“先被依赖者、再依赖者”顺序。
// 需要的机制：同层效果依赖图 + 逐个施加（而非批量求和）；属 `src/layers/` 语义扩展。
import test from "node:test";

test.todo("layers-dependency-vs-timestamp-within-layer: 同层依赖压过时间戳，先算 +2 再算“升至 5”（缺：480.1/481.2 依赖顺序）");
