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
 * status = judge-required（两处缺口均不近似实现）：
 * 1. 没有已合入的 continuous.might 指令原语：契约 3.6 的封闭 GameAction 集合没有
 *    Might 修改动作，effects/instructions/ 下没有该 op，卡牌程序也没有把结算期持续
 *    效果经 ResolveContext.addContinuous 落地为 ContinuousEffectSpec 的入口
 *    （RIFT-91 只合入了 layers 引擎）。
 * 2. 没有已合入的卡牌程序 → 触发注册适配器：CardProgram 的 triggered 能力尚未变成
 *    TriggerRegistration，events 管线收不到 object-readied 订阅（RIFT-120）。
 * 依赖 RIFT-91 与 RIFT-120；不用 Buff 计数器近似临时 Might，也不把触发改成其它时点。
 */
export default {
  canonicalCardId: "card.hash-864252b4f9e2a925ac4decd2d9c2a4df3025182c727f74f452c8d8f70143d8c9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) 「give me +2 :rb_might: this turn」是带本回合期限的临时 Might 修正：契约 3.6 的封闭 " +
    "GameAction 集合没有 Might 修改动作，effects/instructions/ 下没有 continuous.might / effect.might-modify " +
    "原语，卡牌程序也没有把结算期持续效果经 ResolveContext.addContinuous 落地为 ContinuousEffectSpec 的入口" +
    "（RIFT-91 只合入了 layers 引擎；effect.buff 文件头明确临时 Might 归 continuous.might，不能近似为 Buff 计数）；" +
    "(2) 「When I become ready」订阅 object-readied（416.1/416.1.c/416.2），但没有已合入消费方把 CardProgram 的" +
    " triggered 能力注册成事件订阅（CardProgram → TriggerRegistration，RIFT-120），触发无法进链。" +
    "依赖 RIFT-91 与 RIFT-120；不近似实现。",
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
          // 持续修正与 end-of-turn 期限；尚无原语消费（见 judgeReason 第 1 条）。
          id: "fretful-feline.plus-2-might-this-turn",
          op: "continuous.might",
          args: {
            mode: { kind: "constant", value: "add" },
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            // “me” 指能力宿主（053.1），用契约 3.6 的符号选择器。
            object: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    }
  ],
  sourceText: "When I become ready, give me +2 :rb_might: this turn."
} satisfies CardProgram;
