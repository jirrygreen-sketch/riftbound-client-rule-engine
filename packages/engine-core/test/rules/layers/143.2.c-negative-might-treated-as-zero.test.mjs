// RIFT-277 golden test — scenario `layers-negative-might-treated-as-zero`（edge）
//
// 状态：test.todo。缺什么：算术层还没有“实际值可为负、被引用时按 0 计”的模型。
// 现状（engine-core@HEAD 实测，见 /tmp/RIFT-277-rules-tests-layers/probe11.mjs）：
//   * layers engine 在每次算术结算末尾把 Might 夹到 >= 0（engine.ts `applyArithmetic`），
//     因此“实际 -2”根本不存在；minus 后 `might` 是 0。
//   * 也不存在“被引用值 = max(0, 实际值)”的引用层入口，143.2.c 与 143.2.c.1 无法区分开。
// 需要的机制：算术层保留负实际值 + 引用求值器（read-as-zero）两个通道；
// 该改动属 engine-core `src/layers/` 的语义扩展，不在本任务写入范围。
import test from "node:test";

test.todo("layers-negative-might-treated-as-zero: 负 [M] 被引用时按 0 计、实际值仍参与增减（缺：算术层负值模型与引用求值器）");
