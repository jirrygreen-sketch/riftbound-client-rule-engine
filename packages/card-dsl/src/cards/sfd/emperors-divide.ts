import type { CardProgram } from "../../ir/index.js";

/**
 * Emperor's Divide — sfd-043-221 (Spell, 2 energy, power null, Calm, tags []).
 *
 * Printed text (packages/card-data/data/deck-catalog.json, sfd-043-221, verbatim):
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Move any number of friendly units at a battlefield to their base.
 *
 * Catalog evidence: energy 2, power null, might null, domains ["Calm"], tags [].
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) and [Action] (806) are keyword abilities expanded by the
 *   keyword registry (contract 3.7); the card only names them.
 * - "Move any number of friendly units at a battlefield to their base":
 *   355.12 makes every chosen unit a target chosen independently of the game
 *   action and 355.13 lets "any number" include zero, so the TargetSpec is
 *   min 0 / selection "up-to". "friendly" is the controller relationship
 *   (740.1.a) and "at a battlefield" is a targeting restriction on the units,
 *   not a second target (355.10.b example: "Kill a unit at a battlefield"
 *   targets the unit, not the battlefield). The Move itself is the merged
 *   effect.move (421, 448) with destination "controller-base": 107.1.c makes
 *   each unit's Base its controller's Base. The amount is the count of the
 *   finalized units so every one of them may move (the primitive's amount is an
 *   upper bound and moves as many as possible, 359.3.e.11).
 *
 * Status: judge-required（2026-10-18 对源码逐条复核），三项均不近似实现：
 * - [Hidden] 仍无生产消费方：keywords/Hidden.ts 的展开是 static cost.hidden，
 *   programs/statics.ts 的 createEngineStaticBinder.bindStatic 实测抛
 *   ProgramBindingError("Static ability kind cost.hidden has no layer mapping")；
 *   引擎 ZoneId 也没有 facedown 区域（只在 apps/game-server 的 V2 投影里有这个显示名），
 *   因此 811.1.b 的 Hide 自由行动、facedown 存储与 811.1.c/811.6 的免费/Reaction 打出都缺宿主。
 * - 811.1.d.2 的来源绑定目标限制不可写：TargetSpec.location 只接受 LocationFilter，
 *   符号 location selector（source-location / target-location / location-of）经
 *   validateCardProgram 实测报 invalid-location-kind；target/target-plan.ts 的
 *   matchesRequirement 虽有 isLocationSelectorValue 分支，卡牌数据仍无法通过校验写出该形状。
 * - 355.11 的分组一致性不可写：TargetRequirement 的 kind/"group" 字段只有类型定义，
 *   全仓库没有消费方（既不校验「组内同一战场」，也没有 355.11.b/.b.1 的最大合法子集重选）。
 * Move 子效果对已经合法的目标组可在 golden 里真实执行；这不构成完整目标生命周期的证据。
 */
const emperorsDivide = {
  canonicalCardId: "card.hash-ecb9b44b724f5cf8fc83e9f49da0b24bed461053303201914a0ce0ef8db8ed45",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "剩余接线缺口：(1)[Hidden]（811）的展开已合入（keywords/Hidden.ts），" +
    "buildHiddenCostPlan 已支持 Hide [A] 与从 Hidden 免费打出的费用，但 cost.hidden 静态效果没有消费方：" +
    "createEngineStaticBinder.bindStatic 实测抛 ProgramBindingError(\"Static ability kind cost.hidden has no layer mapping\")；" +
    "引擎契约 3.6 的 ZoneId 也没有 facedown 区域（hand/deck/rune-deck/trash/banishment/board/rune-zone/chain），" +
    "只有 apps/game-server 的 V2 投影把隐藏牌显示成 facedown，故 811.1.b/811.1.c/811.6 的 Hide 行动、" +
    "facedown 存储与免费/Reaction 打出都缺宿主。" +
    "(2) 811.1.d.2 要求从 facedown 打出时所有被选单位都位于它被隐藏的战场，这是来源绑定的目标限制；" +
    "TargetSpec.location 只接受 LocationFilter；source-location / target-location / location-of 等符号 location selector " +
    "经 validateCardProgram 实测报 invalid-location-kind，所以「与隐藏（或打出）来源同一战场」这一形状在卡牌数据里写不出来" +
    "（target/target-plan.ts 的 matchesRequirement 虽有 isLocationSelectorValue 分支，静态 IR 无处安放）。" +
    "(3)「at a battlefield」的目标组需满足同一战场约束，并在结算时选择最大合法子集（355.10.b 的 battlefield 限制 + 355.11.a/355.11.b/.b.1）；" +
    "TargetRequirement 的 kind/\"group\" 字段只有类型定义、全仓库无消费方，target-plan 只有逐对象的固定 location 重检。" +
    "effect.move 对已合法目标组的移动（355.12/355.13 的 any number → min 0；107.1.c 的 controller-base）已有真实子效果测试。" +
    "依赖：cost.hidden 的图层/Hide 行动消费方 + facedown 区域的契约表达、TargetSpec.location 的符号选择器校验支持、355.11 的组一致性消费方。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "emperors-divide.move-units",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "emperors-divide.units" } },
            // 107.1.c：每个单位的 Base 就是其控制者的 Base。
            to: { kind: "constant", value: "controller-base" },
            // "any number" 的上界 = 本次 Finalize 锁定的单位数（359.3.e.11）。
            amount: {
              kind: "count",
              subject: "units",
              filter: { object: { target: "emperors-divide.units" } }
            }
          },
          targets: [
            {
              id: "emperors-divide.units",
              filter: { type: "unit", controller: "self", location: "battlefield" },
              min: 0,
              max: null,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Move any number of friendly units at a battlefield to their base."
} satisfies CardProgram;

export default emperorsDivide;
