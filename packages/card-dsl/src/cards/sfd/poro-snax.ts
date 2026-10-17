/**
 * Poro Snax （sfd-046-221）— Gear，1 energy、power 1（Calm），Might null，Calm，无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-046-221）：
 *   "When you play this, draw 1.
 *    :rb_energy_1::rb_rune_calm:, :rb_exhaust:, Kill this: Draw 1."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1：Gear 的 "When you play this…" 是 Play Effect（打出的牌为 Permanent
 *   时结算并进场后再进链，383.4.a.2），对应时点 card-played（chain/engine.ts 在 unit/gear/spell
 *   成功 Resolve 时发射）。
 * - 414.1 / 414.3："Draw 1." 按 414.1.a 从 Main Deck 顶抽 1；effect.draw 原语正是这条效果，
 *   抽牌者缺省为能力控制者（190.6.d 的隐含 "you"）。
 * - 377.1 / 429.6："…: Draw 1." 的冒号前是费用，冒号后是效果，是 Gear 的启动式能力
 *   （151 / 151.2）。费用为 1 energy + 1 点 Calm Power（135.2.e.4 的领域符号）、横置自身
 *   （415.3.a / 415.5）与 "Kill this"（429.2.a / 429.6 的自消灭费用）。费用管线支持
 *   energy/power 与 { kind: "exhaust" | "kill" } 的非标准费用（cost/plan-values.ts），
 *   目标为自身（payment.object 缺省 "self"）。
 * - 两条能力互相独立（"When you play this…" 与启动能力是两个能力），不互相 linkedTo。
 *
 * status = executable：整张卡的两条能力都在已合入路径上执行——
 * 1. Play Effect 半段：RIFT-257 的卡牌程序绑定（programs/triggers.ts +
 *    programs/lifecycle.ts）把本卡的 triggered 能力注册成 TriggerRegistration，链在
 *    gear Resolve 后发射 card-played，触发体经 chain 进入 Pending → Finalize → Resolve，
 *    由已合入的 effect.draw 真实抽 1 张（golden 走真实 ChainEngine + describePlay）。
 * 2. 启动能力半段：describeActivate 生成 ChainDraft（cost 由 cost/plan-values.ts 读取
 *    energy/power/exhaust/kill），Finalize 由 cost/payment.ts 真实支付，Resolve 执行
 *    effect.draw。golden 断言费用扣减、Gear 进 Trash 与抽到的牌数。
 * 打出费用本身由打出流程按印刷值绑定（chain/engine.ts 对 unit/gear/spell 用
 * cost: { kind: "printed" }），因此不在卡内重复声明。
 */
export default {
  canonicalCardId: "card.hash-d4f30fcce9c425fcfc0987d7d2692d637e171ebc5b18e435a74380d01a617c8a",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // "When you play this" — Gear 的 Play Effect 指向本卡自己的打出事件
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

