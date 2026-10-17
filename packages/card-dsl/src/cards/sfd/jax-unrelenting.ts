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
 * - "you may pay :rb_energy_1: to draw 1"：403.1 的 "you may" 是可选效果；契约 3.9 要求把
 *   被选指令包进 choice.optional 的 body（不是 choice + linkedTo）。费用是效果内的支付
 *   （204.1.b 的启动费用词汇）：cost.pay 的 args.payments 接受普通已定形计划
 *   { kind: "constant", value: { energy: 1 } }（effects/instructions/cost.pay.ts 的
 *   paymentsPlan/payablePlan → cost/payment.ts 真实支付），抽出 414.1/414.3 的 effect.draw。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。两处已合入缺口：
 * - [Weaponmaster] 展开（effects/keywords/Weaponmaster.ts）自述 judge-required：需要打出触发
 *   在 Finalize 绑定控制者过滤与所选 Equipment，且 cost.modify / cost.pay 要按 821.1.c.2/.c.3
 *   以"仿佛启动该 Equip 能力"计算费用并支付（821.1.c.2.a 不计入实际启动，821.1.c.6 语义由
 *   该展开负责），这些消费者尚未合入。
 * - object-attached 触发目前不可绑定：events/trigger-spec.ts 的封闭词表 EVENT_PATTERN_TYPES
 *   没有 object-attached 成员（时点本身存在且 action-adapter.ts 会为 attach 动作发射它），
 *   events/trigger-spec.ts 的 assertTriggerSpec 直接拒绝 event: "object-attached" 的
 *   TriggerSpec（golden 用引擎自己的校验器锁定该拒绝）；435.4.a 的宿主身份由
 *   timing-points.ts 的 payloadFields topMostCardId 携带，但卡程序侧还没有把
 *   "to me"（435.1/435.3，重新附着当前宿主不发出）翻译成该载荷谓词的形状。
 * 依赖：Weaponmaster 的 Equip 费用与宿主绑定见 effects/keywords/Weaponmaster.ts 的
 * 自述缺口（821.1.c.2/.c.3）；object-attached 触发词表与宿主绑定见上文。
 * 不近似实现（不手写 Weaponmaster 展开、不把 attach 触发改成其它时点）。
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
                // 403.1 / 204.1.b: an effect-internal payment of 1 Energy.
                // cost.pay's args.payments accepts a plain finalized plan and
                // pays it through the real cost pipeline (cost/payment.ts).
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
    "[Weaponmaster]（821）的展开不可执行：effects/keywords/Weaponmaster.ts 自述 judge-required——821.1.b 的打出触发" +
    "需要一个能绑定控制者过滤与所选 Equipment 的 play 触发层，821.1.c.2/.c.2.a/.c.3 要求 cost.modify 按「仿佛启动该 " +
    "Equip 能力」计算减免 [A] 后的费用、再由 cost.pay 支付（不计入实际启动，821.1.c.6），该消费者尚未合入。" +
    "第二条「When you attach an Equipment to me」（383.1 / 435.1 / 435.3）同样缺可执行触发：object-attached 时点" +
    "存在且 events/action-adapter.ts 会为 attach 动作发射它（payloadFields 含 435.4.a 的 topMostCardId），" +
    "但 events/trigger-spec.ts 的封闭词表 EVENT_PATTERN_TYPES 没有 object-attached 成员，" +
    "引擎自带的 assertTriggerSpec 直接拒绝 event: \"object-attached\" 的 TriggerSpec（golden 用该拒绝锁定证据）；" +
    "卡程序侧也还没有把「to me」翻译成 topMostCardId 载荷谓词的形状。" +
    "正文本身的 may→payments 1 Energy（cost.pay args.payments）→ effect.draw 1（403.1、契约 3.9、414.1/414.3）" +
    "已合入并可由 golden 真实执行：接受时能量 2→1、抽 1，拒绝时 negated/skipped。" +
    "依赖：Weaponmaster 展开（821.1.c.2/.c.3，见 effects/keywords/Weaponmaster.ts）与 object-attached " +
    "触发词表/宿主绑定；不近似实现（不手写 Weaponmaster 展开、不用其它时点代替 attach 触发）。",
  abilities,
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\n" +
    "When you attach an Equipment to me, you may pay :rb_energy_1: to draw 1."
} satisfies CardProgram;

export default program;
