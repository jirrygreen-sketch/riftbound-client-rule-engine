// CR v1.5 420.4.b / 426.1.b — scenario costs-countered-still-counts-as-played-for-cost-checks.
import test from 'node:test';

test.todo('costs-countered-still-counts-as-played-for-cost-checks: 需要 Finalize 期“本回合已 Finalize 过牌”的历史记录（chain 只在 Resolve 发 card-played）；缺该记录无法驱动“played another card this turn”费用减免');
