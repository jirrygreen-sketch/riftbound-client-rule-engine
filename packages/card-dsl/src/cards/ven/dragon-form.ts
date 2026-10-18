import type { CardProgram } from "../../ir/index.js";

/**
 * Dragon Form (ven-116-166) — Spell, 3 energy, no printed Power（power null 不改成 0）, Order, no tags.
 * Might null（法术无印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-116-166，逐字）:
 *   "Choose a unit. Its base Might becomes 5 this turn.\n"
 *   "[Flow] :rb_energy_3: (You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（CR v1.5）：
 * - "Choose a unit"：单位在 Board 上被具体选中，是目标（355.7/355.9.a.1/355.10），
 *   TargetSpec 是真实选择而不是特征集合。
 * - "Its base Might becomes 5 this turn"：143.2.a 区分 Printed / Base / Effective Might，
 *   并把「base Might becomes X」明确划为 **Trait-Altering 层**的设值（143.2.a 的示例就是
 *   "Its base Might becomes 5 this turn."），到期于本回合结束（317.2.c / 475 Layers）。
 *   这不是算术层加减（143.2.a 第二个示例 "Increase its Might to 5" 才是算术层），
 *   也不是 CR 702 的 Buff 计数（effect.buff 文件头明确临时 Might 修改归 continuous.*）。
 * - 语句用 "becomes" 而非 "increase to"，且 143.2.c.1 说明低于 0 的实际值不被钳制，
 *   因此这里不写任何印刷下限。
 * - [Flow]（829）是备选费用关键词：829.1.c 的格式为 "Flow [Cost]"，829.1.b 规定用 Flow
 *   打出后本卡在离开 Chain 时改为放逐。卡只声明关键词身份（契约 3.7/README 第 5 节），
 *   展开（keywords/Flow.ts 的 flow.cost + 延迟替代）归关键词注册表。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（2026-10-18 复核）。
 * 两处依赖未合入，均不近似实现：
 * (1) Trait-Altering 层的 Base Might 设值没有已注册的卡牌侧原语：effects/instructions/ 的
 *     注册表没有 continuous.base-might / set-base-might；continuous.might 的 set 模式落在
 *     算术层（buildMightSpec 产 kind:"set-might"），不等于 143.2.a 的 Trait 层设值；
 *     this-turn 期限别名与图层 set-trait 本身已支持，缺的是卡牌侧设值原语到该图层的接线
 *     （同型记录见 rad/piltovan-guidebot、rad/herald-of-the-emperor）。
 * (2) [Flow] 的专用接线缺失：KeywordDef.expand 已有 params.cost，buildCostPlan 已支持
 *     flow 备选费用与 baseChoices，programs/statics.ts 也已接入 bindReplacement；
 *     但 KeywordAbility / expandProgram 没有把印刷 Flow 费用 3 Energy 传入展开，flow.cost
 *     静态声明也未转为 Finalize 的费用输入与实付实例回执（829.1.c.1/.c.3）。
 *     替代匹配器 ACTION_KINDS 不含 object-leaves-chain，flow-cost-selected 仍为字符串常量，
 *     未按已 finalize、实付 Flow 实例及 leavingInstruction 匹配离链（829.1.b.1）；
 *     从 Trash 打出的许可也未接入打出流程。
 * 本文件不写近似实现：不把 base Might 设值写成 arithmetic 加减，也不把 Flow 降级成普通费用。
 */
const dragonForm = {
  canonicalCardId: "card.hash-ace1c75d6848b5ce9e834068a2b6255d8f82c7ccf918d3063e5a31698ccdacb6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入（2026-10-18 复核），均不近似实现：(1)「Its base Might becomes 5 this turn」是 143.2.a 的 Trait-Altering " +
    "层设值（该条规则的示例正是本句，非算术层加减、非 CR 702 的 Buff 计数），effects/instructions/ " +
    "仍无 continuous.base-might / set-base-might，" +
    "continuous.might 的 set 模式属算术层（buildMightSpec 产 kind:\"set-might\"），不等于 143.2.a 的 Trait 层设值；" +
    "this-turn 期限和 layers.set-trait 已支持，缺卡牌侧设值原语到 Trait 图层的接线；" +
    "143.2.c.1 说明实际值不被钳制，因此不写印刷下限。" +
    "(2) [Flow]（829）的通用费用规划和替代绑定已支持：KeywordDef.expand.params.cost、buildCostPlan 的 flow/baseChoices " +
    "与 programs/statics.ts → bindReplacement 均已合入。缺口是 KeywordAbility / expandProgram 未传递印刷 Flow 费用 3 Energy，" +
    "flow.cost 在 programs/statics 无图层映射，也未接进 Finalize 费用选择与实付实例回执（829.1.c.1/829.1.c.3），以及从 Trash 打出的许可。" +
    "替代匹配器 ACTION_KINDS 不含 object-leaves-chain，flow-cost-selected 仍为字符串常量；尚未按已 finalize、" +
    "实付 Flow 实例及 leavingInstruction 匹配离链（829.1.b.1），不把 Flow 降级成普通费用。" +
    "「Choose a unit」的目标声明本身按 355.7/355.9.a.1 正确，等依赖性合入后即可执行。",
  abilities: [
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      body: [
        {
          // "Its base Might becomes 5 this turn"：Trait 层设值 + this-turn 期限，
          // 原语未注册（见 judgeReason 第 1 点）；不写印刷下限。
          id: "dragon-form.set-base-might",
          op: "continuous.base-might",
          args: {
            value: { kind: "constant", value: 5 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "dragon-form.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Choose a unit. Its base Might becomes 5 this turn.\n" +
    "[Flow] :rb_energy_3: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default dragonForm;
