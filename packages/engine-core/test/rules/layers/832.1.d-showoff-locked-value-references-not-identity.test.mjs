// RIFT-277 golden test — scenario `layers-showoff-locked-value-references-not-identity`（negative）
//
// 状态：test.todo。缺什么：锁定的是“展示时的特征值”而不是对对象身份的持续查询。
// 现状：与 832.1.d / 832.1.d.1 的前两条同源——`cost.reveal` 只有声明没有消费者，
// 因此既没有“锁定值”，也没有可供对比的“结算时重读当前 [M]”路径。
// 需要的机制：展示快照锁定 + 伤害按链接值计算；属 chain/成本/展示接线任务范围。
import test from "node:test";

test.todo("layers-showoff-locked-value-references-not-identity: 伤害用展示时锁定的 [M]，不重读当前值（缺：展示快照与链接值消费）");
