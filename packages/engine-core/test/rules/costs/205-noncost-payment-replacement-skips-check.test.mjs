// CR v1.5 205 / 135.2.b.7 — scenario costs-noncost-payment-replacement-skips-check.
import test from 'node:test';

test.todo('costs-noncost-payment-replacement-skips-check: 需要“非费用支付”游戏动作指令与动作发生检查；现有原语只能通过 finalized 费用计划支付，无法表达支付被替代后“动作未发生”而阻止后续指令');
