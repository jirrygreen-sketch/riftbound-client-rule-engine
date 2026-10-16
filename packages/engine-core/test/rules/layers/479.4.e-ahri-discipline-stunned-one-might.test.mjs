// RIFT-277 golden test — scenario `layers-ahri-discipline-stunned-one-might`
//
// 状态：test.todo。缺什么：减值来源判定与 Ahri 触发接线。
// 现状：
//   * Ahri, Confident / Leona, Zealot / Discipline 的卡牌程序都是 judge-required
//     （packages/card-dsl/src/cards/rad/ahri-confident.ts、ogn/leona-determined.ts），
//     它们声明的 `continuous.might` 原语尚未注册（见 831 / 818 的依赖说明）。
//   * might-changed 的生产者 `deriveMightChangedEmissions` 已存在（events/producers/
//     might-change.ts 实测可产出 previousMight/currentMight），但 src 内没有任何调用方
//     （grep 只命中自身与测试），即层重算不会发布该时点；“减值效果量是否变化”这一 Ahri
//     判定条件（479.4.e.2 的时点语义）在 layers/ 中不可观察。
// 需要的机制：continuous.might 原语 + 层重算到 might-changed 的接线 + 触发过滤。
import test from "node:test";

test.todo("layers-ahri-discipline-stunned-one-might: 1 [M] 眩晕单位被 Discipline 抬到 3 触发敌方 Ahri（缺：continuous.might 原语与 might-changed 触发接线）");
