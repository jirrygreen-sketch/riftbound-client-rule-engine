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
 * - 条件型 Restriction 已有适配，但本卡 use-only-to-play-spells 没有资源来源/
 *   用途追踪及支付消费路径，无法保证该资源只用于打出法术。
 * - 程序绑定将其作为普通 activated 项，未接 Add 的立即结算及支付中启动路径。
 * - Legend Zone（CR 107.4.a–d）不在 ZoneId 中，费用支付只接受 board/rune-zone 的横置对象
 *   （415.4/415.5），传奇无法在真实区域支付 :rb_exhaust:。
 * Universal Power 属契约级缺口；限制消费、Add Reaction 窗口与 Legend Zone 仍缺运行时支持。
 */
const daughterOfTheVoid = {
  canonicalCardId:
    "card.hash-d1376b95989d72f123c2e7fbde3eab74d70c047906b489ce0e076e7e25c757c2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺任意域 Universal Power 的 gain-power 表达与支付（CR 163.2.b）：Domain 仍为六域联合，effect.resources 不支持待定 rainbow 值。" +
    "另缺 use-only-to-play-spells 的资源来源/用途追踪及支付限制消费方；普通 Condition 限制适配不能保证该点 Power 只用于打出法术。" +
    "describeActivate 也未将本能力路由至 Add 的立即结算（430.2/430.2.a）与支付中启动窗口（430.3）。" +
    "另缺 CR 107.4.a–d 的 Legend Zone：ZoneId/ZoneDestination 没有 legend-zone，费用支付只接受 board/rune-zone 的横置对象（415.4/415.5），" +
    "传奇无法在真实区域支付 :rb_exhaust:；golden 的 Board 装置只是部分证据。",
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
