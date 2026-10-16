// CR v1.5 204.3 / 204.3.a — scenarios costs-instruction-cost-resolution and
// costs-instruction-cost-not-paid-no-effect.
import test from 'node:test';

test.todo('costs-instruction-cost-resolution: 需要 cost.pay / cost.additional 指令原语（结算期支付任意量 [A] 并以其实际数额链接伤害量）；现有原语只能提交 finalized 费用计划，无结算期“Pay any amount”入口');

test.todo('costs-instruction-cost-not-paid-no-effect: 需要 choice.optional 在结算期包裹 cost.pay 的接线（不付则后续选择/弃牌不执行）；缺 cost.pay 原语与时点');
