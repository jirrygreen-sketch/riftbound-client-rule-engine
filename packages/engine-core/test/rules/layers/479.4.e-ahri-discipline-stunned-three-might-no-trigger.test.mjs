// RIFT-277 golden test — scenario `layers-ahri-discipline-stunned-three-might-no-trigger`（negative）
//
// 状态：test.todo。缺什么：与上一场景同一组机制（Discipline/Leona/Ahri 的 judge-required
// 卡牌程序、continuous.might 原语、might-changed → 触发接线）。
// 额外缺口：即使接线完成，“减值效果量是否发生变化”这一反面判定（3 [M] 时 -2 已全额生效、
// Discipline 不产生新的减值效果）需要 layers 暴露每个算术效果的施加前/后幅度，当前没有该观察面。
import test from "node:test";

test.todo("layers-ahri-discipline-stunned-three-might-no-trigger: 3 [M] 眩晕单位被 Discipline 抬到 3 不触发 Ahri（缺：同上 + 减值效果量观察）");
