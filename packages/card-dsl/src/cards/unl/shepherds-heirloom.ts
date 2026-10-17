import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shepherd's Heirloom (unl-158-219) — Gear, 2 energy, Might 2, Order, tags [Equipment]。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, unl-158-219）：
 *   "When you play this, gain 1 XP.\n" +
 *   "[Equip] — Spend 1 XP (Pay the cost: Attach this to a unit you control.)"
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1："When you play this" 是 Gear 的 Play Effect，对应时点
 *   card-played（359 / 407），filter 指向本卡自身。
 * - 728 / 730.1 / 730.2："gain 1 XP" 增加该玩家的 XP；己方（"you"）由 190.6.d 的隐含
 *   控制者决定，用已合入的 effect.xp。
 * - 818.1 / 818.1.a / 818.1.b / 818.1.c：Equip 是带费用的启动能力关键词，出现在带
 *   Equipment 标签的 Gear 上（本卡 tags 为 [Equipment]，符合 818.1.a）；依契约 3.7 /
 *   README 第 5 节，卡牌程序只声明关键词与印刷数值，展开属
 *   engine-core/src/effects/keywords/Equip.ts。
 *
 * 印刷的 Equip 费用是 "Spend 1 XP"（818.1.c / 818.1.c.3：Equip 费用可以是非资源费用）：
 * - 契约 3.1 的 `KeywordAbility` 只有 keyword / value 两个字段，没有承载费用种类与
 *   金额的参数槽（对比 sfd/long-sword 用 `costDomain: "Fury"` 记录 Power 费用，那只
 *   在 `as const` 下成立、不被 `satisfies CardProgram` 校验，也不是冻结契约的一部分）。
 *   这里按同类已合入写法只记 `value: 1`（印刷费用数量 1），并在 judgeReason 与回复的
 *   「契约变更请求」里写明费用单位是 XP；不伪造第二条启动能力，也不改 IR 类型。
 * - cost/plan-values.ts 的 readCost 支持 payments kind "xp"（另有 cost.spec.xp 汇总），
 *   但已合入的 keywords/Equip.ts 展开只用 payments: [{ kind: "equip" }]，既没有读取
 *   印刷参数，也没有把 XP 计入费用计划——见 judgeReason。
 *
 * status = judge-required（缺口不近似实现）：
 * - 已合入的 Equip 展开与费用管线不匹配：keywords/Equip.ts 展开出的激活费用是
 *   payments: [{ kind: "equip" }]，而 readCost 对未知支付种类直接 blocked（实测
 *   buildCostPlan 抛 CostPlanError reason "judge-required"、message
 *   "Unsupported payment kind: equip"）；818.1.c.3 允许的这条非资源费用因此
 *   无法在 Finalize 生效（本卡没有 818.1.c.4 的费用改写文本，缺的是把印刷费用送进
 *   费用计划）。
 * "When you play this, gain 1 XP" 用已合入的 effect.xp 由 golden 真实执行；不近似实现
 * Equip 的 XP 支付。依赖：Equip 支付种类与印刷费用参数的契约/费用管线接线、关键词展开读取印刷参数。
 */
const abilities: Ability[] = [
  {
    // 383.4.a.1："When you play this" → card-played（自身打出）。
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "self" } }
    },
    optional: false,
    body: [
      {
        id: "shepherds-heirloom.gain-xp",
        op: "effect.xp",
        args: {
          // 730.1："gain 1 XP"；获得者缺省即能力控制者（190.6.d 的 you）。
          amount: { kind: "constant", value: 1 }
        }
      }
    ]
  },
  {
    // 818.1.c："[Equip] — Spend 1 XP"（818.1.c.3 允许非资源费用）。
    // value 记录印刷费用数量 1（单位是 XP，见文件头与 judgeReason）；展开归
    // keywords/Equip.ts，卡牌程序不重写展开（契约 3.7 / README 第 5 节）。
    kind: "keyword",
    keyword: "equip",
    value: 1
  }
];

const program = {
  canonicalCardId:
    "card.hash-8853921c65fab3eb2f8dc4d5caa2150e248d389203320f385589382ababadec0",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "Equip 的 XP 费用无可执行路径：(1) 已合入的 keywords/Equip.ts 展开出的启动费用是 " +
    "payments: [{ kind: \"equip\" }]，cost/plan-values.ts 的 readCost 对未知支付种类直接 blocked" +
    "（实测 buildCostPlan 抛 CostPlanError reason \"judge-required\"、message " +
    "\"Unsupported payment kind: equip\"），也没有读取本卡印刷的 1 XP 费用" +
    "（818.1.c.3 / 818.1.c.4）；(2) 契约 3.1 的 KeywordAbility 没有费用参数槽，印刷的 " +
    "\"Spend 1 XP\" 只能以 value: 1 记录数量并在本字段说明单位（见回复的契约变更请求）；" +
    "(3) 通用卡牌程序→关键词展开接线已合入，但 Equip 展开仍因上述支付种类而无法通过最终绑定。\"When you play this, gain 1 XP\"（728 / 730.1）已用合入的 " +
    "effect.xp 由 golden 真实执行；不近似实现 Equip 的 XP 支付。依赖：Equip 支付种类与印刷费用参数的契约/费用管线接线、关键词展开读取印刷参数。",
  abilities,
  sourceText:
    "When you play this, gain 1 XP.\n" +
    "[Equip] — Spend 1 XP (Pay the cost: Attach this to a unit you control.)"
};

export default program satisfies CardProgram;
