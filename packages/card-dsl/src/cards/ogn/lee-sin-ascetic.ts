import type { CardProgram } from "../../ir/index.js";

/**
 * Lee Sin, Ascetic (ogn-078-298).
 * CR v1.5 814 / 427.1.b.2 / 702.3: Shield, an exhaust-cost self Buff, unlimited Buffs.
 * The objects operand and maximum:null permission are BLOCKED declarations;
 * current effect.buff has neither a non-target self selector nor a permission hook.
 * Do not encode me as a chosen target or approximate an unlimited Buff with amount:N.
 *
 * status 判定（2026-10-17 复核）：judge-required。三处已实测的当前缺口：
 * 1. effect.buff 的 argsSchema 只接受 TargetSpec id（`target: string`）；"Buff me" 需要非目标的
 *    自身引用，本卡按 `objects: { kind: "constant", value: "self" }` 声明，但把它交给原语会抛
 *    "effect.buff args: target must be a non-empty TargetSpec id"（实测）。CR 355.10.d 明确
 *    “me” 不是选择目标，不能伪造 TargetSpec 绕过。
 * 2. 无限 Buff 许可（427.1.b.2）没有消费方：effect.buff 在 snapshot.buffs > 0 时按 702.3.a
 *    直接跳过，没有读取许可的 hook；本卡声明的 `continuous.restrict { action: "buff", maximum: null }`
 *    虽能经生产 static binder 注册（实测注册成功），但 layers/rules/query.ts 的 restrictions()
 *    只读 `actions`/`amount`/`cap`，不消费 action 单数与 maximum:null。
 * 3. [Shield] 展开的 continuous.might 能绑定，但其 condition 读 `designation` 特征：
 *    ObjectSnapshot 只有 combatRole（契约 3.8），解释器对缺失特征抛 MissingInformation、
 *    生产条件包装返回 false，展开的 +1 Might 当前恒不生效（实测）。
 * 已合入并发可验证：启动费用 `:rb_exhaust:`（自横置）经 translateCost → buildCostPlan →
 * payCostPlan 真实支付（golden 断言 receipt 与 exhausted 状态）。
 * 依赖：非目标自身选择器、多 Buff 许可消费与 Defender designation 条件求值。
 * 不能伪造自身目标、绕过 Buff 原语直接改计数，也不能用 amount:N 近似无限 Buff。
 */
const program = {
  canonicalCardId: "card.hash-cc6ad3795219f298711ebf12535a88b5542ad11cc99575a77634de551464784e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "三处已实测的当前缺口：(1) effect.buff 的 argsSchema 只接受 TargetSpec id（target: string），" +
    "本卡 “Buff me” 声明的非目标自身引用（objects: { kind: \"constant\", value: \"self\" }）交给原语会抛 " +
    "\"effect.buff args: target must be a non-empty TargetSpec id\"；CR 355.10.d 规定 \"me\" 不是选择目标，" +
    "不能伪造 TargetSpec。(2) 无限 Buff 许可（427.1.b.2）没有消费方：effect.buff 在 snapshot.buffs > 0 时按 " +
    "702.3.a 直接跳过、没有许可 hook；本卡声明的 continuous.restrict { action: \"buff\", maximum: null } 能经生产 " +
    "static binder 注册（实测），但 layers/rules/query.ts 的 restrictions() 只读 actions/amount/cap，不消费 " +
    "action 单数与 maximum:null，已有 Buff 时仍会跳过。(3) [Shield] 展开的 continuous.might 能绑定，但其 " +
    "designation 条件在 ObjectSnapshot 上没有特征（只有 combatRole，契约 3.8），解释器抛 MissingInformation、" +
    "生产条件包装返回 false，展开的 +1 Might 当前恒不生效（实测）。" +
    "已合入并发可验证：:rb_exhaust: 的启动费用经 translateCost → buildCostPlan → payCostPlan 真实支付。" +
    "依赖：非目标自身选择器、多 Buff 许可消费与 Defender designation 条件求值；不能伪造自身目标、" +
    "绕过 Buff 原语直接改计数，也不用 amount:N 近似无限 Buff。",
  abilities: [
    {
      kind: "keyword",
      keyword: "shield"
    },
    {
      kind: "activated",
      cost: {
        payments: [
          {
            kind: "exhaust",
            object: "self"
          }
        ]
      },
      timing: "action",
      body: [
        {
          id: "buff-self",
          op: "effect.buff",
          args: {
            mode: {
              kind: "constant",
              value: "buff"
            },
            objects: {
              kind: "constant",
              value: "self"
            }
          }
        }
      ]
    },
    {
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        action: "buff",
        filter: {
          object: "self"
        },
        maximum: null
      }
    }
  ],
  sourceText: "[Shield] (+1 :rb_might: while I'm a defender.)\n:rb_exhaust:: Buff me. (I get a +1 :rb_might: buff.)\nI can have any number of buffs."
} satisfies CardProgram;

export default program;
