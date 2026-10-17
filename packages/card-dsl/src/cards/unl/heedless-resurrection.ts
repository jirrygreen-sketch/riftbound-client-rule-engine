import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Heedless Resurrection (unl-142-219) — Spell, 2 energy + 1 Chaos power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-142-219，逐字):
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   As an additional cost to play this, kill a friendly unit.
 *   Play a unit from your trash that costs no more Energy and no more Power than
 *   the killed unit, ignoring its cost.
 *
 * 规则依据（CR v1.5）:
 * - [Reaction]（813）是许可类关键词：813.1.b 授予 Action 的全部许可，
 *   813.1.c 额外允许在任意玩家的回合、Closed State 期间打出。卡牌只声明关键词，
 *   展开与链的时机判定属 effects/keywords/Reaction.ts 与 chain/（契约 3.7/3.5）。
 * - 「As an additional cost to play this, kill a friendly unit.」按 356.2.a.1 是
 *   强制追加费用（措辞含 "as an additional cost" 而没有 "may"），由被动能力规定，
 *   在费用步骤 4 支付（356.2.a / 357.2）。355.10.c 明示这类「包含 X 作为费用」的
 *   对象不是目标（其示例正是 "As an additional cost to play me, kill a friendly
 *   unit"），所以被消灭的单位走非目标选择（PickSpec），不是 TargetSpec。
 * - 「Play a unit ... from your trash」是效果式的 Play（420.3）。Trash 是公开区域，
 *   355.10.a / 355.9.a 使「你垃圾场中的单位」成为目标（355.7）。
 * - 「that costs no more Energy and no more Power than the killed unit」是对
 *   印刷费用的比较（356.1.c 指向 base cost 时看印刷费用），需要一个同时读取
 *   「被费用消灭的单位」与「候选牌印刷费用」的谓词。
 * - 「ignoring its cost」按 356.1.b.1 把该牌的基础 Energy 与 Power 费用设为 0，
 *   必须由费用管线生成已 finalize 的计划（effect.play 明确只接受已 finalize 的计划，
 *   从不自己推导印刷费用）。
 *
 * status = judge-required：
 * - 缺 static cost.additional 到 CostPlanInput.mandatoryAdditional 的卡牌消费方，
 *   以及将费用 PickSpec 绑定为实时单位引用的 Finalize 选择（356.2.a.1/355.10.c）。
 * - 缺被费用消灭单位的 ObjectSelector/linked 绑定与候选牌的印刷 Energy/Power 上限谓词
 *   （356.1.c）；programs/filters.ts 不接受 printedCostNoMoreThanKilledUnit。
 * - cost/ 已能处理 ignore-base；本卡仍缺把 356.1.b.1 的忽略基础费用语义接入
 *   被打出单位的真实费用计划，保留其追加费用和加费；常量零费回执不证明这条路径。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    // 356.2.a.1：由被动能力规定的强制追加费用「kill a friendly unit」。
    // 355.10.c：费用里的对象不是目标，用非目标选择（choice/PickSpec）声明。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "heedless-resurrection.additional-cost",
      appliesTo: "self",
      optional: false,
      stage: "mandatory-additional",
      payments: [
        {
          kind: "kill",
          amount: { kind: "constant", value: 1 },
          choice: {
            id: "heedless-resurrection.friendly-unit",
            options: ["dynamic:friendly-unit"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { type: "unit", zone: "board", controller: "controller" }
          }
        }
      ]
    }
  },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 2 },
      power: { kind: "constant", value: 1 }
    },
    body: [
      {
        id: "heedless-resurrection.play-unit",
        op: "effect.play",
        args: {
          target: { kind: "constant", value: "heedless-resurrection.unit-in-trash" },
          // 356.1.b.1：ignoring its cost 把 base Energy/Power 置 0；计划形状在此
          // 声明，真正生成 finalized 计划的是费用系统；卡牌打出适配器尚未消费该声明。
          cost: {
            kind: "constant",
            value: { finalized: true, energy: 0, power: [], xp: 0 }
          },
          linkKey: { kind: "constant", value: "played" }
        },
        targets: [
          {
            id: "heedless-resurrection.unit-in-trash",
            // 356.1.c 的印刷费用上限：需与被费用消灭的单位比较（描述性写法，
            // 见 judgeReason；没有消费方会读取这些键）。
            filter: {
              zone: "trash",
              type: "unit",
              owner: "controller",
              printedCostNoMoreThanKilledUnit: true
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-8a8cf37e4136f085e1b3f5e57e7db30e4b4ddadd4f76bcb5a00d613d15514798",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 static cost.additional 到 CostPlanInput.mandatoryAdditional 的卡牌消费方，以及费用 PickSpec 到实时友方单位引用的 Finalize 绑定（CR 356.2.a.1、355.10.c）。缺费用消灭对象的 ObjectSelector/linked 绑定与 356.1.c 的候选单位印刷 Energy/Power 上限谓词；programs/filters.ts 不接受 printedCostNoMoreThanKilledUnit。缺将 356.1.b.1 的 ignore-base 语义接入被打出单位的真实费用计划并保留追加费用/加费；当前 effect.play.args.cost 的常量零费计划只覆盖子效果，不能证明整条忽略基础费用路径。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "As an additional cost to play this, kill a friendly unit.\n" +
    "Play a unit from your trash that costs no more Energy and no more Power than the killed unit, ignoring its cost."
} satisfies CardProgram;

export default program;

