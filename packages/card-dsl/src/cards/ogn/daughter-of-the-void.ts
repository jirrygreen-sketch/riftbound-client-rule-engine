import type { CardProgram } from "../../ir/index.js";

/**
 * Daughter of the Void (ogn-247-298) — Legend, Fury/Mind, Kai'Sa.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-247-298，逐字）：
 *   :rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:. Use only to play
 *   spells. (Abilities that add resources can't be reacted to.)
 *
 * 规则依据（CR v1.5）：
 * - 404.1.a / 415.5：印刷在 “:” 前的 :rb_exhaust: 是启动能力的费用（"Exhaust this"）。
 *   合并的费用管线（cost/plan-values.ts）支持 { kind: "exhaust", object: "self" }。
 * - 813.1.d / 813.1.c：能力上的 [Reaction] 授予 Closed State 的启动许可，IR 用
 *   activated.timing = "reaction" 直接声明；430.3 另允许带 Reaction 的 Add 能力
 *   在需要支付费用时启动。
 * - 430.1 / 430.5：[Add] :rb_rune_rainbow: 是 Add 动作，加入 1 点任意域
 *   （Universal）Power（135.2.e.5 / 135.2.e.5.b、163.2.b）。
 *
 * status = judge-required（三个缺口，均不近似实现）：
 * - 任意域 Power 不可表达：engine-core 的 Domain 是六域封闭联合，effect.resources
 *   明确记录 “Universal Power (163.2.b) is not representable ... never approximated
 *   by a chosen domain”。本卡把 [A] 记为描述性的 power: ["rainbow"]（与 danger-zone
 *   对 [A] 费用的记法一致）；真实原语对 ["rainbow"] 返回 negated(impossible)，
 *   golden 里锁定这条失败证据，而不是选一个域冒充。
 * - “Use only to play spells” 是使用限制，但合并内核没有消费卡牌 Restriction 的路径
 *   （chain Finalize 只检查调用方传入的 Condition），无法保证该资源只用于支付法术。
 * - Add Reaction 的启动窗口（430.3：支付过程中可启动）没有接线。
 * 依赖：RIFT-257（CardProgram 启动能力绑定）、RIFT-261（费用/支付接线）、RIFT-91（限制消费）；Universal Power 属契约级
 * 缺口（见最终回复的「契约变更请求」）。
 */
const daughterOfTheVoid = {
  canonicalCardId:
    "card.hash-d1376b95989d72f123c2e7fbde3eab74d70c047906b489ce0e076e7e25c757c2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺任意域（Universal）Power 的表达与支付：契约/内核的 Domain 是 Fury/Calm/Mind/Body/Chaos/Order 六域" +
    "封闭集合，effect.resources 明确记录 163.2.b 的 [A] 不可表达、绝不用某个域近似；本卡的 " +
    "[Add] :rb_rune_rainbow: 因此只能保留描述性 power: [\"rainbow\"]（原语返回 negated(impossible)）。" +
    "另外 “Use only to play spells” 的使用限制没有消费路径，430.3 的 Add Reaction 启动窗口也未接线。" +
    "依赖 RIFT-257（CardProgram 启动能力绑定）、RIFT-261（费用/支付接线）与 RIFT-91（限制/持续效果消费）。",
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      cost: {
        kind: "activated",
        payments: [{ kind: "exhaust", object: "self" }]
      },
      // “Use only to play spells”: 保留为限制声明；合并内核尚无该 Restriction 的消费方。
      restriction: { kind: "use-only-to-play-spells" },
      body: [
        {
          id: "daughter-of-the-void.add-universal-power",
          op: "effect.resources",
          args: {
            // [A]：任意域 Power。六域封闭集合下没有可执行值，保留描述性记号。
            power: { kind: "constant", value: ["rainbow"] }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:. Use only to play spells. " +
    "(Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default daughterOfTheVoid;
