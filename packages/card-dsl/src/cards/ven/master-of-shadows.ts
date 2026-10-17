import type { CardProgram } from "../../ir/index.js";

/**
 * Master of Shadows (ven-143-166) — Legend, Fury/Chaos, tag Zed.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-143-166，逐字）：
 *   When you banish a card you own, empower me. (I become Empowered if I'm not already.)
 *   [Action][>] Disempower me, :rb_exhaust:: Discard 1, then draw 1.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.1 / 383.2.a / 428.1：句首 “When you banish a card you own” 是触发条件；
 *   封闭时点表里 Banish 的观察时点（ruleRefs 428.1、428.2）承载该条件。
 * - 442.1 / 442.2.a：效果 “empower me” 是 Empower 动作，来源自身为对象（827.1.b.1
 *   同样说明 [Empower] 的来源不是目标），已合入的 effect.empower 可真实执行。
 * - 806.1.d / 135.2.e.7.b：[Action][>] 修饰其后启动能力；契约 3.1 用
 *   activated.timing = "action" 记录（与 RIFT-238 的 Heart of the Tempest 同写法）。
 * - 204.1.b / 443.2 / 443.2.a / 415.5：“:” 前的 “Disempower me” 与 :rb_exhaust: 都是
 *   启动费用的组成部分（Disempower 是 Limited Action），必须能完成才能支付（357/358.2）。
 * - 423.1 / 423.4 / 414.1：“Discard 1, then draw 1” 是两条独立指令；“then” 不产生
 *   链接依赖——423.4 明确“无论弃掉几张，随后照常抽牌”，因此抽牌指令不写 linkedTo。
 *
 * status = judge-required。已合入依赖与剩余生产接线已重新核对；
 * 当前真实缺口以 judgeReason 为准，子效果执行不证明整卡可执行。
 */
const masterOfShadows = {
  canonicalCardId: "card.hash-7e2a7385750d6027b29a1da6a1f5a3301f7cea6ae37c0db13059d67f606b0f5b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺：(1) card-banished 不在 EVENT_PATTERN_TYPES，无法注册 428.1/428.2 的触发条件；action-adapter.ts 对 banish 以对象 controller 推导 player，未保留实际放逐者，无法保证 you banish a card you own；" +
    "(2) cost/plan-values.ts 尚无 disempower 支付种类，无法支付 Disempower me（443.2.a）；" +
    "(3) 参考内核的 empower 动作直接累加，缺 442.1.b/.c 的二元状态幂等保证。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-banished",
        filter: {
          event: "card-banished",
          filter: {
            // “you banish”：执行该次放逐的玩家是能力控制者。
            player: "self",
            // “a card you own”：被放逐的牌的拥有者是能力控制者。
            // 说明：card-dsl 校验器把 object 视为对象选择器锚点，不能承载嵌套 ObjectFilter，
            // 因此拥有者约束以扁平键记录（见 judgeReason 第 1 条；生产触发器载荷仍需扩展）。
            owner: "self"
          }
        }
      },
      // 没有 “you may”，是强制触发。
      optional: false,
      body: [
        {
          id: "master-of-shadows.empower-self",
          op: "effect.empower",
          // “empower me”：来源自身（442.1；827.1.b.1 说明来源不是目标）。
          args: {
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    },
    {
      kind: "activated",
      // [Action][>]：能力级许可关键词（806.1.d），按契约 3.1 记在 activated.timing。
      timing: "action",
      cost: {
        kind: "activated",
        payments: [
          // CR 443.2.a: Disempower is a payment, not an effect in the body.
          { kind: "disempower", object: "self" },
          // :rb_exhaust: = Exhaust 此来源（204.1.b、415.5）。
          { kind: "exhaust", object: "self" }
        ]
      },
      body: [
        {
          id: "master-of-shadows.discard-one",
          op: "effect.discard",
          // “Discard 1”：默认弃牌者是能力控制者，选项按 423.1.a 私下选择。
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "master-of-shadows.draw-one",
          op: "effect.draw",
          // “then” 不产生链接依赖：即使弃牌被否定（423.4 的最后一句），抽牌照常执行。
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "When you banish a card you own, empower me. (I become Empowered if I'm not already.)\n" +
    "[Action][>] Disempower me, :rb_exhaust:: Discard 1, then draw 1."
} satisfies CardProgram;

export default masterOfShadows;
