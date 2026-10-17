import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Jax, Unrelenting (sfd-119-221) — Unit, Body, tags Jax/Icathia/Champion.
 * energy 4, power 1 (Body), Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-119-221，逐字，含换行）:
 *   "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for
 *    :rb_rune_rainbow: less, even if it's already attached.)\n"
 *   "When you attach an Equipment to me, you may pay :rb_energy_1: to draw 1."
 *
 * 规则依据（CR v1.5）：
 * - [Weaponmaster]（821）：Triggered Ability 关键词，821.1.b 规定它是打出时的 Play Effect
 *   且选择一个你控制的 Equipment；821.1.c 给出功能原文（可选、把该 Equipment [Equip] 到
 *   本单位并减免 [A]）；821.1.c.1 说明不要求该 Equipment 有 Equip 能力；821.1.c.7/821.1.d
 *   说明多份 Weaponmaster 各自触发。卡内只声明关键词（契约 3.7/README 第 5 节），展开
 *   （打出触发 + 费用计算/支付 + effect.attach）由 effects/keywords/Weaponmaster.ts 负责。
 * - "When you attach an Equipment to me"（383.1）：封闭时点 object-attached（events/
 *   timing-points.ts，refs 435.1/435.1.g/435.3/435.4.a；435.1 定义 Attach，435.3 规定
 *   重新附着到当前宿主不发出该事件）；"Equipment" 是 Gear 的 tags 特征（150/150.1/150.5），
 *   用 tags: ["Equipment"] 过滤。
 * - "you may pay :rb_energy_1: to draw 1"：403.1 的 "you may" 是可选效果；204.1.c、
 *   404.1.b.1 规定紧跟在可选效果开头的支付必须在 Finalize 选择并支付，而不是在
 *   Resolve 正文中扣除。当前 TriggeredAbility 契约没有 cost 字段，故 IR 只能保留
 *   cost.pay 的可审查形状作为待接线描述；它不能证明这张卡的触发费用已经可执行。
 *   414.1/414.3 的 effect.draw 本体仍可独立执行。
 *
 * Current status: judge-required. Weaponmaster's cost.modify Equipment source
 * branch lacks authoritative Equip costs and original [A]/[C] provenance
 * (cost.modify.ts throws CostPlanError judge-required: 821.1.c.2), and its
 * constant modifier Expr is not unwrapped by chain/interpreter-adapter.ts
 * (TypeError: Invalid cost.modify modifier argument: value). The object-attached
 * adapter emits the Equipment as `object` with no host target or topMostCardId
 * details, while the registered pattern binds this card's identity onto
 * `object`; EventPattern additionally lacks an object-attached member, and
 * TriggeredAbility cannot carry its leading 1 Energy Finalize cost. Resolve-time
 * payment is not a substitute.
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "weaponmaster" },
  {
    kind: "triggered",
    trigger: {
      at: "object-attached",
      filter: {
        event: "object-attached",
        // "an Equipment"：150/150.1 的 Equipment 是 Gear 的 tags 特征（150.5 可由效果读取）。
        target: { type: "gear", tags: ["Equipment"] },
        // "to me"：被附着的宿主是本卡（435.1/435.3）。静态 IR 无法写出自身运行时 id，
        // 声明该同一性；当前 EventPattern 无法表达 topMostCardId 载荷谓词（见 judgeReason）。
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "jax-unrelenting.may-pay",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Pay :rb_energy_1: to draw 1?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "jax-unrelenting.pay-1",
                op: "cost.pay",
                // Deferred declaration: 204.1.c / 404.1.b.1 requires this
                // leading trigger cost at Finalize, not Resolve-time cost.pay.
                args: { payments: { kind: "constant", value: { energy: 1 } } }
              },
              {
                id: "jax-unrelenting.draw-1",
                op: "effect.draw",
                linkedTo: "jax-unrelenting.pay-1",
                args: { amount: { kind: "constant", value: 1 } }
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-e3c3834ab49461988dec4155b965077754fcd478f5efc15474112568b47083ca",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "Weaponmaster 展开及 cost.modify/cost.pay 已合入；当前缺 821.1.b / 821.1.c.2/.c.3 的权威 Equip 费用绑定与" +
    "原始 [A]/[C] 符号来源，cost.modify 的 Equipment source 分支按 judge-required 阻断" +
    "（实测 CostPlanError: 821.1.c.2 missing authoritative Equip-cost binding）。" +
    "原始 Weaponmaster 正文还受 chain/interpreter-adapter.ts 的参数适配阻断：cost.modify 的 constant modifier Expr 未解包为元数据" +
    "（实测 TypeError: Invalid cost.modify modifier argument: value）。" +
    "object-attached 已由 events/action-adapter.ts 从真实 attach 动作派生（435.1 / 435.3），但 EVENT_PATTERN_TYPES " +
    "仍没有该成员（实测 validateTriggerSpec 报 invalid-event-type）。该发射只携带 Equipment object，没有宿主 target 或 topMostCardId details；" +
    "programs/filters.ts 把「to me」声明映射到 object（本卡身份），无法把吸附对象与宿主区分开。" +
    "timing-points.ts 的 payloadFields 声明不是生产载荷，尚不能把「to me」绑定到 Jax（435.4.a）。" +
    "1 Energy 触发费用须在 Finalize 选择并支付（204.1.c / 403.1 / 404.1.b.1）；TriggeredAbility 无 cost 字段，" +
    "programs/triggers.ts 未填 TriggerRegistration.cost/mayAtFinalize。正文 cost.pay 仅为待接线描述。",
  abilities,
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\n" +
    "When you attach an Equipment to me, you may pay :rb_energy_1: to draw 1."
} satisfies CardProgram;

export default program;
