/**
 * Poro Snax （sfd-046-221）— Gear，1 energy、power 1（Calm），Might null，Calm，无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-046-221）：
 *   "When you play this, draw 1.
 *    :rb_energy_1::rb_rune_calm:, :rb_exhaust:, Kill this: Draw 1."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1：Gear 的 "When you play this…" 是 Play Effect（打出的牌为 Permanent
 *   时结算并进场后再进链，383.4.a.2），对应时点 card-played。
 * - 414.1 / 414.3：“Draw 1.”按 414.1.a 从 Main Deck 顶抽 1；已合入的 effect.draw 原语正是
 *   这条效果，抽牌者缺省为能力控制者（190.6.d 的隐含 "you"）。
 * - 377.1 / 429.6：“…: Draw 1.”的冒号前是费用，冒号后是效果，是 Gear 的启动式能力
 *   （151 / 151.2）。费用为 1 energy + 1 点 Calm Power（135.2.e.4 的领域符号）、横置自身
 *   （415.3.a / 415.5）与 “Kill this”（429.2.a / 429.6 的自消灭费用）。已合入的费用管线
 *   支持 energy/power 与 { kind: "exhaust" | "kill" } 的非标准费用（cost/plan-values.ts），
 *   目标为自身（payment.object 缺省 "self"，cost/plan-values.ts 的 reference）。
 * - 两条能力互相独立（“When you play this…” 与启动能力是两个能力），不互相 linkedTo。
 *
 * status = judge-required（触发到链的生产接线未合入，不近似实现）：
 * - 上半段 “When you play this, draw 1.” 是 Play Effect（383.4.a.2），按契约 3.5 必须先由
 *   时点→触发→入链再结算；没有已合入模块把卡牌程序的 triggered 能力注册进 events/pipeline
 *   （TriggerRegistration 只有引擎内部 delayed 注册路径，chain/engine.ts 只从 delay 触发），
 *   card-played 的生产发射方也只在 chain/engine.ts 的链结算里出现，长在已注册能力之上。
 *   这与已合入的同类 M2 卡（sfd bubble-bot / ogn spirits-refuge / ogs annie-stubborn）一致：
 *   它们把 awaited TriggerRegistration 接线写成 test.todo，本卡按同一口径保持 judge-required。
 * - 下半段的费用可以支付（golden 用真实费用管线执行 energy/power 与 exhaust+kill），
 *   但“Draw 1.”仍走上面的触发/链依赖；费用本身的所有者校验（cost/payment.ts 的
 *   checkAction）也不接受已离场的来源，因此整卡的执行证据只能是分段真实执行。
 * - 依赖：RIFT-120（batch4 链与事件的卡牌程序触发接线）。不近似实现。
 */
export default {
  canonicalCardId: "card.hash-d4f30fcce9c425fcfc0987d7d2692d637e171ebc5b18e435a74380d01a617c8a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺卡牌程序→触发→链的生产接线：(1) “When you play this, draw 1.” 是 Gear 的 Play Effect" +
    "（383.4.a.1/383.4.a.2），按契约 3.5 必须先经时点→触发→入链；已合入的 events/pipeline 只有" +
    "引擎内部的 delayed 注册路径（chain/engine.ts 的 registerDelayedTrigger），没有任何生产模块把" +
    "卡牌程序的 triggered 能力注册成 TriggerRegistration（与已合入 sfd bubble-bot、ogn spirits-refuge" +
    "的同一缺口），card-played 仅由链结算自身发射；(2) 启动能力的“Draw 1.”同样只能在触发/链完成" +
    "Finalize 后结算。依赖：RIFT-120（batch4 链与事件的卡牌程序触发接线）。" +
    "已可真实执行的部分：启动费用 1 energy + 1 Calm Power + 横置自身 + Kill this（151/151.2、" +
    "415.3.a/415.5、429.2.a/429.6，cost/plan-values.ts 与 cost/payment.ts）与两条 effect.draw 指令" +
    "（414.1/414.3），golden 分段执行并覆盖目标失效分支。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // “When you play this” — Gear 的 Play Effect 指向本卡自己的打出事件
        // （ObjectFilter 的 canonicalCardId 字段；EventPattern.object 匹配打出事件的牌）。
        filter: {
          event: "card-played",
          object: {
            canonicalCardId:
              "card.hash-d4f30fcce9c425fcfc0987d7d2692d637e171ebc5b18e435a74380d01a617c8a"
          }
        }
      },
      optional: false,
      body: [
        {
          id: "poro-snax.play-draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    },
    {
      kind: "activated",
      // Gear 启动能力默认 Action 时机（151.2）；费用是印刷的 ":rb_energy_1::rb_rune_calm:,
      // :rb_exhaust:, Kill this"（377.1）：1 energy + 1 Calm Power + 横置自身 + 消灭自身。
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: ["Calm"] },
        payments: [
          { kind: "exhaust", object: "self" },
          { kind: "kill", object: "self" }
        ]
      },
      timing: "action",
      body: [
        {
          id: "poro-snax.ability-draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "When you play this, draw 1.\n:rb_energy_1::rb_rune_calm:, :rb_exhaust:, Kill this: Draw 1."
} as const;
