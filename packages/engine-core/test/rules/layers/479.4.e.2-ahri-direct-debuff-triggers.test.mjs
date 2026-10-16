// RIFT-277 golden test — scenario `layers-ahri-direct-debuff-triggers`
//
// 状态：test.todo。缺什么：非零 -[M] 的施加路径与触发接线。
// 现状：
//   * 直接给 -2 [M] 需要一个登记的原语（`continuous.might`）或等价算术效果施加接口；
//     `src/effects/instructions/registry.generated.ts` 登记的 31 个原语里没有该 op
//     （effect.buff 的头注释也明确“Might 数值修改属于 continuous.might，不属于本原语”）。
//   * Ahri 的“被你操控对象的能力减少敌方单位 [M] 时抽牌”触发是 judge-required 卡程序，
//     might-changed 也没有接到事件管线（只有 producers 里的纯函数）。
// 需要的机制：continuous.might 原语 + 结算时发布 might-changed + 触发过滤（见上两条）。
import test from "node:test";

test.todo("layers-ahri-direct-debuff-triggers: 法术施加非零 -[M] 直接触发 Ahri（缺：continuous.might 原语与触发接线）");
