// RIFT-277 golden test — scenario `layers-showoff-locked-info-survives-zone-change`
//
// 状态：test.todo。缺什么：与上一条同一组机制，另需展示对象离场后链接值仍可用。
// 现状：`objects-shown-off` 时点已在 events/timing-points.ts 注册（payloadFields 含
// chainItemId/objectIds/snapshots），但没有任何生产者提交它；832.1.c.4 的“对象在 Finalize
// 期间离开区域”处理与 832.1.d.1 的链接值存活也都不存在。
// 需要的机制：展示快照 + 离场后链接值保留；属 chain/事件接线任务范围。
import test from "node:test";

test.todo("layers-showoff-locked-info-survives-zone-change: 展示对象离开区域后锁定信息仍可用（缺：objects-shown-off 生产者与链接值存活）");
