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
 *   已合入纯派生产生方 deriveAbilityActivatedEmission（events/producers/
 *   ability-activation.ts）：完整能力启动取得 committed 结果后产生该时点。filter 用 EventPattern
 *   的 player: "self" 表达「你使用」（= 启动该能力的玩家，能力控制者）。
 * - "of a gear"：被使用的能力来源必须是 gear。EventPattern.source 是 ObjectFilter，指向事件载荷的
 *   来源对象（timing-points.ts 的 payloadFields: sourceId），故写 source: { type: "gear" }。
 * - "give me +1 :rb_might: this turn"：本回合到期的临时 Might 修正，属算术图层（143.2.a、475–478）；
 *   "me" 是能力宿主。已合入的 continuous.might 原语经 ResolveContext.addContinuous
 *   登记 arithmetic 层效果，并按 317.1.a/468.7.c 把 "this-turn" 解析为 end-of-turn 期限。
 *   绝不能写成 Buff 计数（702/703：Buff 是每单位限一个的 +1 计数器，语义不同），也不用
 *   applyTo 之外的旧式 object 参数（已合入 argsSchema 会拒绝）。用 appliesTo: "self" 表达宿主。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，触发订阅仍缺生产接线，不近似实现：
 * - ability-activated 的纯派生器已合入，但没有已合入调用方：全仓库除该文件自身与
 *   timing-points 定义外没有任何地方调用 deriveAbilityActivatedEmission（chain/engine.ts 的
 *   activateAddDuringPayment / execute 只发出 card-played 与链时点），因此该时点在生产中仍不会
 *   进入事件管线；chain 也没有把「已经 committed 的启动能力结果」交给该派生器的接线
 *   的 programs/activate.ts 只生成 ChainDraft，不产生启动回执）。同型缺口见 ven/curator-of-the-sands。
 * - 效果本体本身已可执行：golden 用解释器 + 图层引擎真实执行 continuous.might 的登记与生效值。
 * 依赖：启动能力时点产生方的调用接线（producers 接入 chain）与启动回执。
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
        // 经已合入的 continuous.might 原语登记，期限为本回合结束；绝不用 Buff 近似。
        id: "prize-of-progress.give-plus-1-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "this-turn" },
          // 宿主自身：appliesTo 简写（continuous.might 的已合入参数，与显式选择参数互斥）。
          appliesTo: { kind: "constant", value: "self" }
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
    "触发订阅缺生产接线，不近似实现：ability-activated 的纯派生器已合入（events/producers/ability-activation.ts 的 " +
    "deriveAbilityActivatedEmission，只对 committed 结果产生时点），但没有已合入调用方——全仓库除该文件与 timing-points 定义外没有任何地方调用它， " +
    "chain/engine.ts 只发射 card-played 与链时点，也没有把「已 committed 的启动能力结果」交给派生器的接线；programs/activate.ts " +
    "只生成 ChainDraft、不产生启动回执。因此该触发仍无法进入链（同型缺口见 ven/curator-of-the-sands）。" +
    "效果本体已可执行：「give me +1 :rb_might: this turn」由已合入的 continuous.might 登记 arithmetic 层效果， " +
    "appliesTo self + this-turn 期限（143.2.a、317.1.a/468.7.c），golden 用解释器 + 图层引擎真实执行并断言生效 Might。 " +
    "依赖：派生器接入 chain 的调用接线与启动回执。绝不用 Buff 计数近似（702/703）。",
  abilities,
  sourceText: "When you use an activated ability of a gear, give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;

