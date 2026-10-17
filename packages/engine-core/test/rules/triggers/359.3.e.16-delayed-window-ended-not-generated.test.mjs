// CR v1.5 359.3.e.16 / 391.2 golden test — scenario `triggers-delayed-window-ended-not-generated`
// (docs/rules/scenarios/triggers.yaml).
//
// 359.3.e.16: "If a Delayed Ability's duration has ended before it was generated, the
// Delayed Ability is not generated." Targon's Peak is the example: a Conquer that happens
// after the End Phase has begun can no longer generate its "at the end of this turn"
// delayed trigger.
//
// 状态：test.todo。缺什么：延迟触发原语的窗口期限（windowId / expiresAt / windowClosed）。
// 现状：
//   * 已登记的 42 个原语里没有任何一个调用 `ctx.registerDelayedTrigger`；卡面里的
//     `trigger.delayed` 因此没有执行入口，也就没有“生成时窗口已结束”的判定点。
//   * 事件管线内部的 `expiresAt` 只能表达注册后的到期时点
//     （`pipeline-types.ts` / `pipeline.ts` 的 wave 清理），无法表达
//     “注册请求本身晚于窗口关闭”的拒绝，`chain/README.md` 的契约变更请求 3 已记录。
//   * 由于没有延迟触发生成路径，写“不生成”的断言只会变成对缺失功能的断言；按规则红线
//     不近似实现。
// 需要的机制：`registerDelayedTrigger` 的窗口参数（`{ windowId, expiresAt, windowClosed }`）
// 由解释器内部适配器传入，窗口关闭时拒绝注册。
import test from 'node:test';

test.todo('triggers-delayed-window-ended-not-generated (359.3.e.16 / 391.2): 缺延迟触发窗口期限——无原语调用 registerDelayedTrigger，expiresAt 只表达注册后到期，无法在注册请求晚于窗口关闭时拒绝生成');
