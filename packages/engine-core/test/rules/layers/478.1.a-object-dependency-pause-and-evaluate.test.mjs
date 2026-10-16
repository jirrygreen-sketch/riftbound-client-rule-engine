// RIFT-277 golden test — scenario `layers-object-dependency-pause-and-evaluate`
//
// 状态：test.todo。部分机制已可执行，本场景的整体语义尚不可。
// 已能执行的部分（见 478.1.b-dependency-chain-evaluate-from-endpoint.test.mjs 的真实测试）：
//   `engine.evaluate` 递归求值被引用的对象，`set-tags` 的 `object-property` 引用会先算完 #u1。
// 缺什么：
//   1. `layer: "trait"`（与 ability 层）只在算术层之前施加一次，478.3 的“每层序列完成后
//      递归重评”只对 ability 层做了一次补查（engine.ts `evaluate` 注释），特征层不重查。
//      实测（probe14/12）：4 [M] +1 buff 的 #u1 的 Mighty 条件标签始终为空。
//   2. “拥有全部标签”的集合依赖只能靠 `set-tags` + `object-property` 的整体复制表达；
//      ObjectFilter 没有“全部标签/任意标签”谓词（layers/filter.ts 只做精确 tags 包含）。
// 需要的机制：特征层重查 + 集合型依赖谓词，属 `src/layers/` 语义扩展，不在本任务写入范围。
import test from "node:test";

test.todo("layers-object-dependency-pause-and-evaluate: 计算“拥有全部标签”的单位前先暂停求值被引用对象（缺：特征层重查与集合依赖谓词）");
