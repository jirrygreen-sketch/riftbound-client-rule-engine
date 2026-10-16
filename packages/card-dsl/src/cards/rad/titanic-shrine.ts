import type { CardProgram } from "../../ir/index.js";

/**
 * Titanic Shrine (rad-089-167) — Gear, 3 energy、power null，Body，tags [Device]。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json rad-089-167）：
 *   "When you play a unit with Might greater than each other unit on the board,
 *    exhaust me to draw 1."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a.4："当另一个对象被打出时触发"的能力不是 Play Effect，而是订阅 card-played
 *   时点的普通触发能力（条件包含“你打出一个单位”）。
 * - 204.1.c / 204.3 / 355.10.c.1："exhaust me to draw 1" 是成本内指令（[do X] to [do Y]）
 *   ——横置自身是费用、抽 1 是效果；费用必须支付，能力才成立。横置作为费用属于
 *   cost.exhaust / 费用计划（415.4/415.5），不是 effect.exhaust。
 * - 414.3："draw 1" 经 effect.draw 结算，抽牌者隐含为能力控制者（190.6.d）。
 *
 * status：judge-required。三处缺口：
 * 1. 成本内指令的费用支付：契约 3.1 的 TriggeredAbility 没有 cost 字段，指令层面也没有
 *    注册的 cost.pay 原语（engine-core instructions 注册表只有 effect.* 与解释器内建的
 *    控制 / 条件节点），行内 cost.pay 会被解释器拒绝为未注册 opcode。
 * 2. "Might greater than each other unit on the board"：需要把被打出的单位从其
 *    card-played 事件载荷绑定出来（契约 3.6 的 ObjectSelector 没有“事件对象”形式），
 *    并对 Board 上其他单位做数值 Might 比较；events/pipeline-match.ts 的过滤器没有数值
 *    Might 匹配键，condition 也无法对“每个其他单位”逐一比较。
 * 3. 即便条件与费用就绪，也没有卡牌程序 → 触发注册的接线（契约 3.5）。
 * 不把条件近似成“总是成立”，也不把横置费用写成 effect.exhaust。
 */
export default {
  canonicalCardId: "card.hash-4647932ee2d6158c5f7a09247a187cb76e06c69e293aea63f24b3d7ee7dc2a7c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1)「exhaust me to draw 1」是成本内指令（204.1.c/204.3/355.10.c.1）：" +
    "TriggeredAbility 没有 cost 字段，指令层也没有注册的 cost.pay 原语" +
    "（engine-core instructions 注册表不含 cost.pay），费用计划与 Finalize 收费管线未接通；" +
    "(2)「Might greater than each other unit on the board」需要从 card-played 事件载荷绑定" +
    "被打出的单位（ObjectSelector 没有事件对象形式），并对 Board 上其他单位做数值 Might 比较" +
    "（events/pipeline-match.ts 的过滤器没有数值 Might 键，condition 也无法逐一比较）；" +
    "(3) 缺少卡牌程序→触发注册的接线（契约 3.5）。" +
    "Draw 1 原语已合入并单独执行；不近似实现条件与横置费用。",
  abilities: [
    {
      // 383.4.a.4：订阅 card-played（"you play a unit"）。"你"按触发控制者判定，
      // 用 trigger-spec.ts 的 PlayerSelector "self"；"Might greater than each other
      // unit on the board" 谓词无法表达（见 judgeReason 第 2 点），因此这里不写条件，
      // 不把条件近似成恒真。
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { type: "unit", player: "self" } }
      },
      optional: false,
      body: [
        {
          // 204.3：成本内指令先支付（横置自身），由费用管线接管；当前无 cost.pay 原语。
          id: "titanic-shrine.pay-exhaust",
          op: "cost.pay",
          args: {
            payments: { kind: "constant", value: [{ kind: "exhaust", object: "self" }] }
          }
        },
        {
          // 费用支付后抽 1（414.3）。"then" 是顺序词而不是结果绑定，故不写 linkedTo：
          // 横置作为费用失败时能力根本无法成立，不依赖链接传播来表达这一点。
          id: "titanic-shrine.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "When you play a unit with Might greater than each other unit on the board, exhaust me to draw 1."
} satisfies CardProgram;
