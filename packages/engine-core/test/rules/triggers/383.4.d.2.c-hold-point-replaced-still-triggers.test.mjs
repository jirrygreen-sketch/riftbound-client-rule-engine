// CR v1.5 383.4.d.2.c golden test — scenario `triggers-hold-point-replaced-still-triggers`
// (docs/rules/scenarios/triggers.yaml).
//
// 383.4.d.2.c: "If the act of gaining one point from Holding is negated or replaced
// in any way, the Hold Effect will still trigger."
//
// 状态：test.todo。缺什么：结构性 Score 替代任务。
// 现状：
//   * 未被替代的 Hold 波已由同目录 `383.4.d.2.a-hold-unit-present.test.mjs` 真实执行
//     （points-gained → hold → score → chain-item-pending，全部来自 TurnFlow 的
//     Beginning Phase Scoring Step，没有手工结算）。
//   * 与 383.4.c.2.c 同源：点数的取得是 TurnFlow 的结构性 Score 任务，登记的点数替代
//     会让 `turn/flow.ts` 抛
//     `TurnCombatBlockedError('replaced-scoring', 'Replaced point gains require a structural Score task contract')`，
//     不会继续发布 hold/score 波。
//   * 按规则红线不近似实现，也不写“断言该功能不存在”的测试。
// 需要的机制：Score 动作的替代协议（被替代/否定后仍完成 Scoring、发布 hold 与 score 时点）。
import test from 'node:test';

test.todo('triggers-hold-point-replaced-still-triggers (383.4.d.2.c): 缺结构性 Score 替代任务——TurnFlow 对得分被替代抛 replaced-scoring，无法在未得分的情况下继续发布 hold/score 波并让 Hold Effect 入链');
