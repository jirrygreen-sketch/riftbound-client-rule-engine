// CR v1.5 383.4.g.1 golden test — scenario `triggers-activate-named-trigger-checks-other-conditions`
// (docs/rules/scenarios/triggers.yaml).
//
// 383.4.g.1: activating a named triggered ability means the player checks the
// condition of every specified effect as if the named part had been fulfilled, and
// places the ones whose remaining conditions hold on the Chain as if they had just
// triggered. Reckoner's Arena (When you hold here, activate the conquer effects of
// units here) is the CR example.
//
// 状态：test.todo。缺什么：命名触发激活入口 + “here” 锚点。
// 现状：
//   * `src/effects/instructions/registry.generated.ts` 的 42 个已登记原语里没有命名触发
//     激活 op（`effect.activate-named-trigger` 只在 card-dsl 的 judge-required 卡面里作为
//     未注册占位出现）。
//   * 事件管线的触发扫描只会把真实时点转成 Pending 项；没有“把具名部分视为已满足、
//     再检查其余条件”的内部入口，`chain/README.md` 的契约变更请求 3 已记录。
//   * “units here” 的相对战场锚点同样缺失：`programs/filters.ts` 对 `here` 直接抛
//     judge-required。合成一次 hold→conquer 会把 383.4.g.2 明确禁止的“真实事件”造出来。
//   * 按规则红线不近似实现，也不写“断言该功能不存在”的测试。
// 需要的机制：命名触发激活入口（`{ namedTriggerId, checkCondition: true, emitOriginalEvent: false }`）
// + 战场相对锚点求值。
import test from 'node:test';

test.todo('triggers-activate-named-trigger-checks-other-conditions (383.4.g.1): 缺命名触发激活原语与“units here”战场锚点——登记原语集无 activate-named-trigger，programs/filters.ts 对 here 抛 judge-required，无法在 hold 后逐个检查征服效果其余条件并入链');
