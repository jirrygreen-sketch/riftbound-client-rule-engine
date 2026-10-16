import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Prize of Progress (sfd-075-221) — Unit, Mind, Mech/Piltover.
 * energy 4, power 1 (Mind), Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-075-221，逐字）:
 *   "When you use an activated ability of a gear, give me +1 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）:
 * - "When you use an activated ability"（400/402/405–407）：使用启动能力是与打出卡牌同一套流程的
 *   Activate 步骤；封闭时点 ability-activated 的语义即「启动能力完成合法打出流程后发出；
 *   取消或未成功完成费用及合法性检查不算使用能力」（timing-points.ts，ruleRefs 400/402/405/406/407）。
 *   filter 用 EventPattern 的 player: "self" 表达「你使用」（= 启动该能力的玩家，能力控制者）。
 * - "of a gear"：被使用的能力来源必须是 gear。EventPattern.source 是 ObjectFilter，指向事件载荷的
 *   来源对象（timing-points.ts 的 payloadFields: sourceId），故写 source: { type: "gear" }。
 * - "give me +1 :rb_might: this turn"：本回合到期的临时 Might 修正，属算术图层（143.2.a、475–478）；
 *   "me" 是能力宿主，用符号选择器 "self"。effect.buff 文件头明确临时 Might 修改归 continuous.might，
 *   绝不能写成 Buff 计数（702/703：Buff 是每单位限一个的 +1 计数器，语义不同）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，两处依赖未合入，均不近似实现：
 * - 触发订阅无接线：ability-activated（400/402/405–407）在 timing-points.ts 里只有**定义**，
 *   全仓库没有任何 emit 调用（events/action-adapter.ts 的 ACTION_TIMINGS 只为已提交的游戏动作
 *   派生时点，启动能力的 Pending/Finalize/Resolve 属 chain/），也没有把 CardProgram 的 triggered
 *   ability 注册成 events 的 TriggerRegistration 的适配器（RIFT-120）。
 * - 效果本体无原语：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 下
 *   没有任何通过 ResolveContext.addContinuous 注册连续效果的指令（layers 只提供求值侧，RIFT-91）。
 * 依赖：RIFT-120（启动能力时点发射与卡牌触发注册）、RIFT-9/RIFT-91（连续 Might 修改原语与图层注册）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "ability-activated",
      // 「你使用一个 gear 的启动能力」：使用者是 event.player（能力控制者，190.6.d），
      // 被使用能力的来源对象必须是 gear（payloadFields 的 sourceId）。
      filter: { event: "ability-activated", player: "self", source: { type: "gear" } }
    },
    optional: false,
    body: [
      {
        // 「give me +1 :rb_might: this turn」— 算术图层的临时 Might 修正（143.2.a、475–478），
        // 声明为连续效果形状；没有任何已合入指令注册它（见 judgeReason）。绝不用 Buff 近似。
        id: "prize-of-progress.give-plus-1-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "this-turn" },
          object: { kind: "constant", value: "self" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-2affca3f8f8306aa0687163e5113f3532b04acb9960f806d7a7eba3bf504104a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) 触发订阅无接线：ability-activated（400/402/405–407）在 timing-points.ts 里只有定义，" +
    "全仓库没有任何 emit 调用（events/action-adapter.ts 只为已提交的游戏动作派生时点，启动能力的 Pending/Finalize/Resolve 属 chain/），" +
    "也没有把 CardProgram 的 triggered ability 注册成 events 的 TriggerRegistration 的适配器（RIFT-120）。" +
    "(2)「give me +1 :rb_might: this turn」是带 end-of-turn 期限的临时 Might 修正（143.2.a、475–478）：" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 下没有通过 ResolveContext.addContinuous " +
    "注册 continuous.might 的指令，layers 只提供求值侧（RIFT-91）；effect.buff 的计数语义不同（702/703），不近似。" +
    "依赖：RIFT-120（启动能力时点发射与卡牌触发注册）、RIFT-9/RIFT-91（连续 Might 修改原语与图层注册）。",
  abilities,
  sourceText: "When you use an activated ability of a gear, give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;
