import type { CardProgram } from "../../ir/index.js";

/**
 * Fretful Feline (ven-071-166) — Unit, 6 Energy, 5 Might, Body, Cat/Piltover
 * （无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-071-166，逐字）：
 *   When I become ready, give me +2 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 416.1 / 416.1.c / 416.2：“become ready” 是 Ready 动作造成的状态变化；封闭时点
 *   枚举里的 object-readied（ruleRefs 416.1 / 416.1.c）即该时刻，因此按 383 的
 *   触发式能力写法订阅该时点，filter 用契约 3.6 的符号选择器指向来源自身。
 * - 412.4：能力“当你做某事时”触发，在对应 Game Action 发生时触发；本卡因此订阅
 *   重置动作本身，而不是任何结算期的查询。
 * - 143.2.a：“give me +2 :rb_might: this turn” 是算术图层的临时 Might 修正（契约
 *   3.4 的 layers 顺序 copy → trait → ability → arithmetic）；effect.buff 的文件头
 *   明确临时 Might 修改归 continuous.might，不是 Buff 计数器（702）。
 * - “this turn” 是本回合期限，由时点驱动的到期处理（315.4 / 清理步骤）。
 *
 * status = judge-required：ready 生产者、普通触发注册、单次 +2 与回合末到期均可执行。
 * 同一对象本回合两次从 exhausted 变为 ready 的真实链测试（2026-10-17 复核）仍然抛
 * Error: Continuous effect already registered（continuous.might 的同一个 settlement-1 标识）：
 * continuous.might 的 settlementIdentity 把计数写到 qualified key（ctx.link 的 path 前缀），
 * 但下一次结算读回时走的是非限定键，于是每次都算成 settlement-1；同一条链里的
 * LayerEngine 便拒绝重复 id。事件侧同样仍不满足 416.1.c：对已 ready 单位执行 ready
 * 仍会发出 object-readied（events/action-adapter.ts 只按 action.type 映射时点，
 * 不比较 before/after 的 exhausted 状态），回归测试实测 ready 事件数 1 → 2。
 * 必须修复共享解释器的结算身份读写与事件生产者的状态变化门控；卡牌不能伪造事件 ID 绕过。
 */
export default {
  canonicalCardId: "card.hash-864252b4f9e2a925ac4decd2d9c2a4df3025182c727f74f452c8d8f70143d8c9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "同一回合再次从 exhausted 变为 ready（416.1/416.2）应再次给予 +2 Might；当前解释器把 settlement counter " +
    "写成指令限定键、下一次结算按非限定键读取，导致 continuous.might 重复注册同一个 settlement-1 标识，实测抛 " +
    "\"Continuous effect already registered\"。缺共享解释器/链路的跨结算唯一" +
    "注册身份；另缺 events/action-adapter 对 ready 状态实际变化的门控，实测对已 ready 单位的无效 ready 仍把 " +
    "object-readied 事件数从 1 加到 2（违反 416.1.c）。不近似限制每回合触发次数。",
  abilities: [
    {
      kind: "triggered",
      // 416.2 / 412.4：“become ready” 对应封闭时点 object-readied。
      trigger: {
        at: "object-readied",
        filter: { event: "object-readied", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          // 「give me +2 :rb_might: this turn」的有效 IR 形状：arithmetic 图层的
          // 持续修正与 end-of-turn 期限由 continuous.might 和图层到期路径消费。
          id: "fretful-feline.plus-2-might-this-turn",
          op: "continuous.might",
          args: {
            mode: { kind: "constant", value: "add" },
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            // “me” 指能力宿主（053.1），用契约 3.6 的符号选择器。
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText: "When I become ready, give me +2 :rb_might: this turn."
} satisfies CardProgram;
