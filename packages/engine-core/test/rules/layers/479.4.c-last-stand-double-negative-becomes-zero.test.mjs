// RIFT-277 golden test — scenario `layers-last-stand-double-negative-becomes-zero`（edge）
//
// 状态：test.todo。缺什么：需要“当前 [M] 为负”这一前提，以及把“翻倍”按 479.4.c 折叠成
// “增加当前值”的算术效果。
// 现状（实测 /tmp/RIFT-277-rules-tests-layers/probe11.mjs 20）：
//   * 算术层在结算末尾把 Might 夹到 >= 0（engine.ts `applyArithmetic`），Eclipse 的 -4 打在
//     2 [M] 上得到的是 0，无法形成官方例里的 -2。
//   * `applyArithmetic` 的 multiply/double 分支直接把 might 乘 2；没有 479.4.c 的
//     “负量增加改为 +0”判定，也没有“增加当前值”的表达式入口。
// 需要的机制：算术层负实际值模型 + 负量增加折叠；属 `src/layers/` 语义扩展。
import test from "node:test";

test.todo("layers-last-stand-double-negative-becomes-zero: 当前 [M] 为负时“翻倍”按增加 0 处理（缺：负值模型与 479.4.c 折叠）");
