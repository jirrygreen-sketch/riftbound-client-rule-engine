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
 * status: judge-required（已按合入依赖复核；缺口不近似实现）:
 * - 强制追加费用仍未接线（356.2.a.1 / 356.2.a / 357.2）：cost/plan-values.ts 已支持 kill 类的对象支付，
 *   但没有任何已合入消费方把本卡声明的 static cost.additional 能力变成 CostPlanInput.mandatoryAdditional
 *   （卡牌程序 → 费用计划的生产入口仍属 RIFT-261 进行中的费用种类与 cost.pay/cost.modify 范围）；
 *   同一声明里的 PickSpec options 也不能枚举运行期 Board 单位（cost/plan-values.ts 要求精确 ObjectRef）。
 * - 费用结果无法绑定进效果体：冻结 IR 的 ObjectSelector 只有 self/source/target/pick/linked，费用计划里的非目标选择
 *   不是链接值，因此 356.1.c 的「印刷费用不高于被消灭单位」比较既没有求值路径，也没有对应的 ObjectFilter 键
 *   （programs/filters.ts 会拒绝描述性键；未知键在 layers/ 与测试内核里也只是被静默忽略，不能当成已实现）。
 * - 「ignoring its cost」需要费用系统产出 base Energy/Power 为 0 的 finalized 计划（356.1.b.1，RIFT-261）。
 * golden 用已合入的 effect.play + 显式零费计划对锁定目标真实执行，并单独执行 effect.kill 的 pick 形态证明
 * 费用半段可执行；整卡不宣称可执行。依赖：RIFT-261（费用计划/追加费用/ignore-cost 接线）、RIFT-90（印刷费用上限谓词）。
 * 无契约变更请求。
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
          // 声明，真正生成 finalized 计划的是费用系统（RIFT-89）。
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
    "(1)「As an additional cost to play this, kill a friendly unit.」是 356.2.a.1 的强制追加费用（cost.sacrifice 型）：" +
    "cost/plan-values.ts 已支持 kill 类的对象支付，但没有任何已合入消费方把本卡声明的 static cost.additional 能力变成 CostPlanInput.mandatoryAdditional" +
    "（卡牌程序 → 费用计划的生产入口仍属 RIFT-261 的费用种类与 cost.pay/cost.modify 范围）；同一声明的 PickSpec options 也不能枚举运行期 Board 单位。" +
    "(2) 费用结果无法绑定进效果体：冻结 IR 的 ObjectSelector 只有 self/source/target/pick/linked，费用计划里的非目标选择不是链接值，" +
    "因此「that costs no more Energy and no more Power than the killed unit」（356.1.c 的印刷费用比较）既缺少与费用选择相连的求值路径，" +
    "也缺少印刷费用上限谓词（programs/filters.ts 拒绝描述性键；未知键会被 layers/filter.ts 与测试内核静默忽略，不能当成已实现）。" +
    "(3)「ignoring its cost」按 356.1.b.1 需要费用系统产出 base Energy/Power 为 0 的 finalized 计划（effect.play 明确不接受自行推导的费用，RIFT-261）。" +
    "golden 用已合入的 effect.play + 显式零费计划与 effect.kill 的 picks 形态执行已支持部分；整卡不近似实现。" +
    "依赖：RIFT-261（费用计划/追加费用/ignore-cost 接线）、RIFT-90（印刷费用上限谓词）。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "As an additional cost to play this, kill a friendly unit.\n" +
    "Play a unit from your trash that costs no more Energy and no more Power than the killed unit, ignoring its cost."
} satisfies CardProgram;

export default program;

