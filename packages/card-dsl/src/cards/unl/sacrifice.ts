import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sacrifice (unl-173-219) — Spell, 1 energy, no printed power, Order.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-173-219，逐字):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   As an additional cost to play this, kill a friendly [Mighty] unit. (A unit is
 *   Mighty while it has 5+ :rb_might:.)
 *   Draw 2 and channel 1 rune exhausted.
 *
 * 规则依据（CR v1.5）:
 * - [Reaction]（813）是许可类关键词：813.1.b 授予 Action 的全部许可，813.1.c
 *   额外允许在任意玩家的回合、Closed State 期间打出。卡牌只声明关键词。
 * - 「As an additional cost to play this, kill a friendly [Mighty] unit.」按
 *   356.2.a.1 是强制追加费用（"as an additional cost" 且无 "may"），由被动能力
 *   规定、在费用步骤 4 支付；355.10.c 明示费用里的对象不是目标，故用非目标选择
 *   （PickSpec）声明。
 * - 「[Mighty]」按 706–711 是「当前 Might ≥ 5」的描述（707/708），在场上按当前
 *   Might 评估（710）。它是费用选择的限制条件，需要读取 143.2.a 的有效 Might。
 * - 「Draw 2」是 414.1/414.3 的抽牌（effect.draw）；「channel 1 rune exhausted」
 *   是 431.1 的引导，并用 431.2/431.2.a 的进入规定让符文以横置状态进场
 *   （effect.channel 的 exhausted 参数）。两句由 "and" 连接但动作独立，不写 linkedTo
 *   （055 / 359.3.e.11：能做什么做什么）。
 *
 * status = judge-required（2026-10-17 对源码逐条复核）：
 * 两处当前缺口：(1) 强制追加费用（CR 356.2.a.1）的 cost.additional 静态声明仍没有消费方把它接进 Finalize 费用计划：
 * programs/play.ts 的 translateCost 对 kind "additional"/"additional-cost" 直接 judgeRequired
 * （实测 "Additional costs are not bound for sacrifice"），describePlay 只从 play ability 的 cost 生成计划、
 * 不收集 static cost.additional；programs/statics.ts 的 layerFor 也把该静态效果以
 * "Static ability kind cost.additional has no layer mapping" 拒绝（实测）。cost/plan-values.ts 的 kill 支付
 * 与 buildCostPlan 的 mandatoryAdditional 本体已可执行，缺的只是这条卡牌声明→计划的接线。
 * (2) friendly [Mighty] unit（706–711）的费用选择缺动态候选与 Might 谓词：cost/plan-values.ts 的 choiceObjects
 * 逐个把 choice.options 经 reference() 解析为精确 ObjectRef，符号占位（"dynamic:friendly-mighty-unit"）会以
 * "Cost requires an exact object reference" 失败（实测），也不读取 choice.filter 中的 mightGte，
 * 没有挑选期绑定"该玩家自己的、当前 Might >= 5"候选集合的路径。Mighty 谓词本身已合入；
 * 不能用任意友方单位近似该费用。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    // 356.2.a.1：由被动能力规定的强制追加费用「kill a friendly [Mighty] unit」。
    // 355.10.c：费用里的对象不是目标；Mighty 限制（707/708：Might >= 5）随费用
    // 选择声明，其谓词见 judgeReason。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "sacrifice.additional-cost",
      appliesTo: "self",
      optional: false,
      stage: "mandatory-additional",
      payments: [
        {
          kind: "kill",
          amount: { kind: "constant", value: 1 },
          choice: {
            id: "sacrifice.mighty-unit",
            options: ["dynamic:friendly-mighty-unit"],
            min: 1,
            max: 1,
            selection: "one",
            filter: {
              type: "unit",
              zone: "board",
              controller: "controller",
              // 706–711 的 Mighty 阈值（当前 Might >= 5）；描述性键，无消费方。
              mightGte: 5
            }
          }
        }
      ]
    }
  },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 1 }
    },
    body: [
      {
        id: "sacrifice.draw",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 2 } }
      },
      {
        // 431.1 / 431.2.a：以 exhausted 规定引导，符文横置进入符文区。
        id: "sacrifice.channel",
        op: "effect.channel",
        args: {
          amount: { kind: "constant", value: 1 },
          exhausted: { kind: "constant", value: true }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-33403d8f77f3caa9aa8f59a1a0290c3e349fe6a5893c3b812340601ac4a0629a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处当前缺口（均不近似实现）：(1) 强制追加费用（CR 356.2.a.1）的 cost.additional 静态声明没有消费方接进 Finalize 费用计划：" +
    "programs/play.ts 的 translateCost 对 kind \"additional\"/\"additional-cost\" 直接 judgeRequired" +
    "（实测 \"Additional costs are not bound for sacrifice\"），describePlay 只从 play ability 的 cost 生成计划、" +
    "不收集 static cost.additional；programs/statics.ts 的 layerFor 也以 " +
    "\"Static ability kind cost.additional has no layer mapping\" 拒绝该静态效果（实测）。" +
    "buildCostPlan 的 mandatoryAdditional 与 plan-values 的 kill 支付本体已可执行，缺的只是这条卡牌声明→计划的接线。" +
    "(2) friendly [Mighty] unit（706–711）的费用选择缺动态候选与 Might 谓词：cost/plan-values.ts 的 choiceObjects " +
    "逐个把 choice.options 经 reference() 解析成精确 ObjectRef，符号占位会以 \"Cost requires an exact object reference\" 失败（实测），" +
    "也不读取 choice.filter 中的 mightGte，没有挑选期绑定「该玩家自己的、当前 Might >= 5」候选集合的路径。" +
    "Mighty 谓词本身已合入；不能用任意友方单位近似该费用。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "As an additional cost to play this, kill a friendly [Mighty] unit. (A unit is Mighty while it has 5+ :rb_might:.)\n" +
    "Draw 2 and channel 1 rune exhausted."
} satisfies CardProgram;

export default program;

