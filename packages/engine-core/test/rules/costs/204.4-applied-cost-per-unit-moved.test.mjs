// CR v1.5 204.4 / 204.4.b — scenarios costs-applied-cost-per-unit-moved and
// costs-applied-cost-unpaid-blocks-action.
import test from 'node:test';

test.todo('costs-applied-cost-per-unit-moved: 需要应用型费用模块（204.4）与移动动作支付窗口接线；当前无 applied-cost 原语，Standard Move 本身也因缺 Exhaust+Move 原子事务而 blocked');

test.todo('costs-applied-cost-unpaid-blocks-action: 需要应用型费用模块在动作执行前校验支付（204.4.c）；缺该模块使“不付则动作不能执行”不可执行');
