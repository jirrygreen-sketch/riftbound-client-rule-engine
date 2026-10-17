import type { CardProgram } from "../../ir/index.js";

/**
 * Hextech Anomaly (sfd-083-221) — Gear, 3 energy + 1 Mind power, 领域 Mind, 标签为空。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json sfd-083-221）：
 *   ":rb_exhaust:: [Reaction] — Pay any amount of :rb_rune_rainbow: to [Add] that much
 *    Energy. (Abilities that add resources can't be reacted to.)"
 *
 * 规则依据（CR v1.5）：
 * - 404.1.a / 415.4 / 415.5：印刷的 :rb_exhaust: 是启动费用「横置自身」，必须能完成。
 * - 813.1.c.2 / 813.1.d：能力上的 [Reaction] 授予 Closed State 的启动许可，IR 用
 *   activated.timing = "reaction" 声明（对照 ogn 的 Seal of Focus / Energy Conduit）。
 * - 204.3 / 204.3.a：「Pay any amount of [A] to [Add] that much Energy.」是指令内费用；
 *   204.3 的示例直接点名同型文本（Ancient Henge“[Reaction][>] [E]: Pay any amount of
 *   Energy to Add that much [A].”）：金额在结算时由玩家选择，Add 的量就是实付额。
 * - 430.1 / 430.5 / 430.2.a：[Add] 把资源放进 Rune Pool，此处加的是 Energy；Reaction 的
 *   Add 启动能力 Finalize 后立即结算、不传递 Priority/Focus（由链与费用管线负责）。
 * - 135.2.e.5.a / 163.2.b：:rb_rune_rainbow: 是任意域 Power [A]，作为费用可由任意域 Power
 *   支付；163.2.b 的 Universal Power 不在六域封闭集合内。
 *
 * status = judge-required（复核 2026-10-17；三处缺口，均不近似实现）：
 * 1. 结算期任意数量支付没有已注册原语：204.3/204.3.a 的指令内费用要求玩家在结算时选择金额，
 *    且实付额必须可被后续指令读取；已注册的 cost.pay 只接受 { cost, power,
 *    nonstandardOrder, payments, linkKey } 且金额是固定值，没有「结算期选择金额」的形状，
 *    effects/instructions 里也没有任何结算期的任意数量支付原语（程序里保留的 cost.pay-any
 *    会在解释器中以 "Unregistered instruction opcode: cost.pay-any" 失败；
 *    同型缺口见 ogn 的 Bullet Time, Miss Fortune）。
 * 2. 任意域 Power [A] 的支付与增益无法表达：六域封闭 Domain 集合没有 Universal Power 成员，
 *    effect.resources 的文件头明确 Universal Power 保持 unsupported、绝不用某个域近似；
 *    cost.pay 的 payments 记录同样只接受六域（以 rainbow 支付时 cost/payment.ts 抛
 *    invalid domain），因此实付额的域组成无法记录或重现。
 * 3. 启动能力 → 链的生产接线本身已合入（describeActivate 能生成草稿、chain/engine.ts 有
 *    430.3 的 activateAddDuringPayment 窗口），但 body 里未注册的 cost.pay-any 使
 *    Finalize 后无法结算；golden 以真实费用管线执行横置半段（415.4/415.5）、
 *    describeActivate 的草稿形状，以及 [Add] 半段（effect.resources）。
 * 依赖：结算期任意数量支付原语（含发布实付额）、Universal Power 的契约扩展。
 * 不把金额写死，也不把 [A] 近似成某个具体域。
 */
export default {
  canonicalCardId: "card.hash-58dcd4ef13c8ed65c72940c3d6474f1160275091a8b05488aa6bcbab5c57c2ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口：(1)「Pay any amount of [A]」是 204.3/204.3.a 的指令内费用（同型文本见该条示例 Ancient Henge）：" +
    "金额在结算时由玩家选择且 [Add] 的量必须是实付额，但已注册原语里没有任何「结算期任意数量支付并发布实付额」的形态" +
    "——cost.pay 的 payments/cost 都要求固定金额，且其参数集合不含金额选择；effects/instructions 下也没有等价原语，" +
    "程序保留的 cost.pay-any 会在解释器中以 \"Unregistered instruction opcode: cost.pay-any\" 失败（同型缺口见 Bullet Time, Miss Fortune）；" +
    "(2) :rb_rune_rainbow: 是任意域 Power [A]（135.2.e.5.a / 163.2.b 的 Universal Power），六域封闭 Domain 集合无法表达，" +
    "effect.resources 文件头明确 Universal Power 保持 unsupported；cost.pay 的 payments 记录同样只接受六域" +
    "（以 rainbow 支付时 cost/payment.ts 抛 invalid domain），因此实付额的域组成无法记录或重现；" +
    "(3) 启动能力 → 链的生产接线已合入（describeActivate 生成草稿、chain/engine.ts 提供 430.3 的 " +
    "activateAddDuringPayment 窗口），但 body 里未注册的 cost.pay-any 使 Finalize 后无法结算。" +
    "已可真实执行的部分：横置费用（415.4/415.5）、describeActivate 的草稿形状与 [Add] 半段" +
    "（effect.resources，实付额由调用方链接值提供），golden 均已执行。" +
    "依赖：结算期任意数量支付原语（含发布实付额）与 Universal Power 的契约扩展。" +
    "不近似实现（金额不写死，[A] 不落到具体域）。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "activated",
      // 813.1.c.2：能力上的 [Reaction] 授予 Closed State 的启动许可，由链读取该 timing。
      timing: "reaction",
      cost: {
        kind: "activated",
        // 415.4/415.5：横置自身作为费用。
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          // 204.3/204.3.a：「Pay any amount of [A]」——结算期由玩家选择金额，并把实付额发布给
          // 后续指令；当前没有该原语（见 judgeReason 第 1 点）。该指令当前不可执行。
          id: "hextech-anomaly.pay-any-amount",
          op: "cost.pay-any",
          args: {
            resource: { kind: "constant", value: "power" },
            domain: { kind: "constant", value: "rainbow" },
            amount: { kind: "constant", value: "any" },
            linkKey: { kind: "constant", value: "paid" },
            prompt: { kind: "constant", value: "Pay any amount of [A]?" }
          }
        },
        {
          // 430.1/430.5：「[Add] that much Energy」——加成量必须是实付额。
          id: "hextech-anomaly.add-energy",
          op: "effect.resources",
          linkedTo: "hextech-anomaly.pay-any-amount",
          args: {
            energy: {
              kind: "linked-value",
              instructionId: "hextech-anomaly.pay-any-amount",
              key: "paid"
            },
            linkKey: { kind: "constant", value: "added" }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction] — Pay any amount of :rb_rune_rainbow: to [Add] that much Energy. " +
    "(Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;
