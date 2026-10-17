import type { CardProgram } from "../../ir/index.js";

/**
 * Vaults of Helia (unl-219-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-219-219, 逐字)：
 *   When you hold here, your non-token units cost :rb_energy_1: more to play
 *   this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b：“When you hold here” 是 Hold Effect；
 *   时点用封闭表的 hold（scoring/ 发出，ruleRefs 315.2.b.2 / 471.2 / 473.2.b），
 *   190.6.d 的 “you” 是战场控制者。
 * - 349 / 356.3：“cost :rb_energy_1: more” 是费用增加，在构建那次打出的费用计划时
 *   施加（费用增加在 356.3 阶段、折扣在 356.4 阶段之前），不是结算期的游戏动作。
 * - 356.7 / 204.1：费用由打出该牌的玩家支付；增加作用于“你的非 token 单位”，即
 *   控制者为该玩家的单位，且 185.1.a 的 token 性质被排除（185.3.a.1 另定 token
 *   费用视为 0，与本句“非 token”限定一致）。
 * - “this turn” 是本回合期限：由时点驱动的到期（契约 3.5），起于 hold 结算、止于
 *   回合结束。
 *
 * status = judge-required（逐个记录缺口，复核 2026-10-17；不近似实现）：
 * 1. cost.modify 原语与 CostPlan 的 increase 阶段已合入，但仍缺把该触发效果安装到
 *    “本回合稍后打出”的 CardProgram→CostPlan 路径；
 *    cost/buildCostPlan 虽接受 increases（356.3 阶段）且 golden 证明算术成立，但只作用于
 *    调用方提供的单次计划，没有任何已合入路径把 CardProgram 的 static 能力放进后续打出的
 *    CostPlanInput.increases。
 * 2. hold 已由 turn/flow.ts 发出，且 CardProgram 的普通 triggered ability 注册接线已合入；
 *    但 programs/filters.ts 仍以 “Unsupported filter field here” 拒绝 here: true（053.3 的占位）；
 *    复核实测 registerProgramTriggers 对整卡 fail-closed。
 * 3. 本回合期限需要与时点绑定：layers 的 Duration 有 end-of-turn，但没有“hold 之后到回合结束”
 *    这条由触发开启的费用期限的已合入接线。
 * 依赖：CardProgram→CostPlan 的静态加费接线（RIFT-261）、RIFT-31/RIFT-33 的 here 载荷。
 */
export default {
  canonicalCardId: "card.hash-0b929c2c78280ff14e852a6d803fa3e55251591cfc73088ec115c83af1360d7e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) cost.modify 原语与 cost/buildCostPlan 的 356.3 increases 阶段已合入，" +
    "但没有任何路径把本触发能力安装进本回合后续打出的 CostPlanInput.increases，" +
    "该生产接线仍缺。" +
    "(2) 触发侧：hold 时点（383.4.d、315.2.b.2、471.2、473.2.b）现已由 turn/flow.ts 的 Score wave 发出，但没有已合入订阅方把卡牌程序的 triggered ability 注册成触发" +
    "但 programs/filters.ts 以 \"Unsupported filter field here\" 拒绝 here: true（053.3 的占位）；复核实测 registerProgramTriggers 对整卡 fail-closed。" +
    "(3) 「this turn」需要由触发开启、回合结束到期的费用期限：layers 的 Duration 可表达 end-of-turn，但没有 hold 触发开启该期限的已合入接线。" +
    "程序保留 non-token 单位的过滤形状（185.1.a 的 token 性质、356.7 的付款玩家）；依赖 CardProgram→CostPlan 的静态加费接线（RIFT-261）与 RIFT-31/RIFT-33 的 here 载荷。不近似实现。",
  sourceText: "When you hold here, your non-token units cost :rb_energy_1: more to play this turn.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // “here” 是本战场、“you” 是战场控制者（053.3、190.6.d）；here 占位键等待
        // scoring 载荷（见 judgeReason 第 2 点）。
        filter: { event: "hold", here: true, player: "controller" }
      },
      // 原文没有 “may”，是强制触发；加费本身由费用计划在打出时施加。
      optional: false,
      body: [
        {
          id: "vaults-of-helia.increase-unit-cost",
          // 356.3 / 356.4：这是费用增加阶段的声明（不是结算期的资源动作）；
          // cost.modify 原语已合入；CardProgram→CostPlan 的安装仍是 judgeReason 第 1 点。
          op: "cost.modify",
          args: {
            resource: { kind: "constant", value: "energy" },
            amount: { kind: "constant", value: 1 },
            appliesTo: { kind: "constant", value: "play-cost" },
            filter: {
              kind: "constant",
              value: {
                // “your non-token units”：控制者为本能力控制者、非 token 的单位。
                type: "unit",
                controller: "controller",
                // 185.1.a：token 性质由 isToken 表达（layers 过滤器支持该键）。
                isToken: false
              }
            },
            // “this turn”：期限由触发开启、回合结束到期（见 judgeReason 第 3 点）。
            duration: { kind: "constant", value: "this-turn" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
