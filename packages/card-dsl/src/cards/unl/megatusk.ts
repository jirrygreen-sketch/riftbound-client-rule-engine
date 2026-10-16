import type { CardProgram } from "../../ir/index.js";

/**
 * Megatusk (unl-126-219) — Unit, Chaos, tag Bilgewater。
 * catalog：energy 6、power null（无印刷力量）、might 6。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-126-219，逐字）：
 *   Spend 3 XP: Give your units here [Ganking] this turn. (We can move from
 *   battlefield to battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - 204.1.b / 377.1：冒号之前的 “Spend 3 XP” 是启动能力的基础费用（730.2 Spend XP）；
 *   415.5 的 exhaust 符号不是本卡的写法。费用形态对齐已合入的费用管线
 *   （cost/plan-values.ts 的 `kind: "xp"` 支付组件 + payment.ts 的 spend-xp 动作）。
 * - 376 / 377.3 / 310.1.a：启动能力进链；本卡没有印刷 [Action]/[Reaction]，按默认
 *   Action 时机（同 unl/bashful-bloom 的写法）。
 * - “Give your units here [Ganking] this turn”：801.3.a.2（授予关键词的效果须写明期限）
 *   与 317.2.c（所有 “this turn” 效果在 Expiration Step 同时到期）；Ganking 的
 *   KeywordDef（810.1–810.3，stacking single）与 layers 的 duration 机制已合入。
 *   “your units here” 是 359.3.f 的 here 指代（来源当前位置），用契约 3.6 的
 *   `sameLocationAs: "source"` 锚点表达；“here 的你的单位”是按特征选定的完整集合、
 *   没有可选余地（355.10.d：程序化选定的对象不是目标），因此用 `selection: "all"`、
 *   `min: 0`（同 rad/the-ball、ogn/kogmaw-caustic 对集合的写法），不是 “up to”。
 *
 * status = judge-required（缺口不近似实现）：
 * - effects/instructions/ 里没有任何已注册原语能把“授予关键词”写成可执行指令：
 *   RIFT-9 清单与 ability-templates 第 247 行的 continuous.keyword /
 *   continuous.grant-keyword 都还没有实现文件（仓库里只有 ogn/bounty-hunter 等卡牌
 *   程序的描述性声明），所以 body 在已合入内核上无法执行；
 * - layers（RIFT-91）只消费调用方注册的 ContinuousEffectSpec，没有
 *   CardProgram instruction → 图层的注册入口；被授予的 Ganking 还需在接收者上按
 *   810 再展开一次（两级处理），这一步同样未合入。
 * 已合入且可执行的是本卡的启动费用：golden 用 buildCostPlan + payCostPlan 真实支付
 * 3 XP（并且验证 XP 不足时费用管线如实拒绝）。
 *
 * 依赖：RIFT-9（continuous.keyword 原语）、RIFT-81（关键词展开）、RIFT-91（layers
 * 接线）、RIFT-89（费用计划）。
 */
export default {
  canonicalCardId:
    "card.hash-1c5a34df03f1f2101ee472f6d3fd4673e56683b49f28e64e3d9d4291bc6d8448",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Give your units here [Ganking] this turn」需要能由卡牌 body 执行的持续关键词授予：" +
    "RIFT-9 清单与 ability-templates 第 247 行的 continuous.keyword / continuous.grant-keyword 在 " +
    "effects/instructions/ 下没有实现文件（只有其他卡牌程序里的描述性声明），layers（RIFT-91）也没有 " +
    "「CardProgram 指令 → 图层注册」的入口，因此本卡 body 在已合入内核上无法执行；被授予的 Ganking " +
    "还需按 810 在接收者上再展开一次（两级处理）。" +
    "已合入且可执行的是启动费用（204.1.b / 730.2 的 “Spend 3 XP”）：golden 用 buildCostPlan + " +
    "payCostPlan 真实支付 3 XP，并验证 XP 不足时被拒绝。依赖：RIFT-9（continuous.keyword）、RIFT-81、" +
    "RIFT-91（layers 接线）、RIFT-89（费用计划）。不近似实现。",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        // 204.1.b：冒号前的基础费用。730.2：Spend XP 减少该玩家已标记的 XP。
        kind: "activated",
        payments: [{ kind: "xp", amount: { kind: "constant", value: 3 } }]
      },
      body: [
        {
          id: "megatusk.grant-ganking",
          // 「Give your units here [Ganking] this turn」——801.3.a.2 的限时关键词授予。
          // 该 op 未在 effects/instructions/ 注册（见 judgeReason），
          // 结构按关键词能力的小写 id 与 end-of-turn 期限书写。
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "ganking" },
            duration: { kind: "constant", value: "end-of-turn" }
          },
          targets: [
            {
              id: "megatusk.units-here",
              // “your units here”：控制者是能力控制者，位置与来源相同（359.3.f）。
              // 355.10.d：按特征程序化选定的完整集合不是目标选择，这里只声明集合范围。
              filter: {
                type: "unit",
                controller: "controller",
                zone: "board",
                sameLocationAs: "source"
              },
              min: 0,
              selection: "all"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Spend 3 XP: Give your units here [Ganking] this turn. (We can move from " +
    "battlefield to battlefield.)"
} satisfies CardProgram;
