import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Legion Quartermaster (sfd-044-221) — Unit, Calm, Trifarian/Noxus.
 * energy 3, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-044-221，逐字）:
 *   "As an additional cost to play me, return a friendly gear to its owner's hand."
 *
 * 规则依据（CR v1.5）:
 * - 356.2 / 356.2.a：由「被打出牌自身的被动能力」指定的附加费用，在 Total Cost 的
 *   第 2 步「Apply additional costs」收取。本句没有 "may"，按 356.2.b.1 的反面是
 *   强制附加费用（Mandatory Additional Cost）；CR 各处（如 CR-v1.5.txt:1881）用
 *   "As an additional cost to play me, …" 正是该措辞。
 * - 355.10.c 与 CR 的官方例子（"e.g., 'As an additional cost to play me, kill a
 *   friendly unit' doesn't target anything"）明确：费用的一部分所包含的游戏对象**不是
 *   目标**，因此不用 TargetSpec，而是费用组件里的结算期选择（非目标 pick）。
 * - "return a friendly gear to its owner's hand"：414.1 的「移入手牌」类区域移动，
 *   目的区域是**其拥有者**的手牌（"its owner's hand"），不是控制者的手牌；既有
 *   GameAction `return-to-hand` 正是该语义（owner 决定目的地）。
 * - "a friendly gear"：150/141 的类型与 355.9.a.1 的默认区域——Board 上的 gear，
 *   且由本卡控制者控制（"friendly"）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 缺「卡牌程序 → 费用计划」的接线：已合入的 cost/ 计划只消费调用方传入的
 *   mandatoryAdditional（cost/cost-plan.ts），没有任何模块把卡程序声明的附加费用
 *   接进 Finalize（RIFT-89）。
 * - 已合入的非标准费用组件词汇是 cost/plan-values.ts 的 exhaust/discard/recycle/
 *   kill/reveal/spend-buff；`return-to-hand` 不在其中，因此返回手牌的强制附加费用
 *   即使接上费用管线也没有可支付组件。
 * 本文件按契约 3.1 把该强制附加费用声明为 static 的 cost.additional（appliesTo
 * "self"、optional false、stage "mandatory-additional"），费用对象用非目标 pick 表达，
 * 不把费用改写成效果、也不写成 TargetSpec。依赖：RIFT-89（费用计划接线与费用组件）。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "legion-quartermaster.additional-cost",
      appliesTo: "self",
      // 356.2.b.1：没有 "may" 的 "As an additional cost" 是强制附加费用。
      optional: false,
      stage: "mandatory-additional",
      payments: [
        {
          // 355.10.c：费用中的对象不是目标（非目标 pick，结算期选择）。
          kind: "return-to-hand",
          amount: { kind: "constant", value: 1 },
          choice: {
            id: "legion-quartermaster.friendly-gear",
            options: ["dynamic:friendly-gear-on-board"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { type: "gear", zone: "board", controller: "controller" }
          }
        }
      ]
    }
  }
];

const program = {
  canonicalCardId: "card.hash-a010c6a3b5692bc45e1c1a552db574267b69092695de19dc7869f7089ece7cb2",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺「卡牌程序 → 费用计划」接线：356.2/356.2.a 的强制附加费用要在 Total Cost 第 2 步收取，" +
    "但已合入的 cost/ 只消费调用方传入的 mandatoryAdditional（cost/cost-plan.ts），没有任何模块把卡程序声明的 " +
    "cost.additional 接进 Finalize（RIFT-89）；并且已合入的非标准费用组件词汇只有 " +
    "exhaust/discard/recycle/kill/reveal/spend-buff（cost/plan-values.ts 的 NonstandardCostAction），" +
    "\"return a friendly gear to its owner's hand\"（414.1 的区域移动，目的地是拥有者手牌）没有可支付组件。" +
    "费用对象按 355.10.c 的非目标 pick 表达、不写成 TargetSpec，也不把费用改写成效果。" +
    "依赖：RIFT-89（费用计划接线与 return-to-hand 费用组件）。不近似实现。",
  abilities,
  sourceText: "As an additional cost to play me, return a friendly gear to its owner's hand."
} satisfies CardProgram;

export default program;
