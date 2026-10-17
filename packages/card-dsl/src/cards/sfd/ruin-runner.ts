import type { CardProgram } from "../../ir/index.js";

/**
 * Ruin Runner (sfd-105-221) — Unit, 6 energy, 无印刷 Power, Might 5，
 * 领域 Body，标签 Shurima。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-105-221，逐字）：
 *   "I can't be chosen by enemy spells and abilities."
 *
 * 规则依据（Core Rules v1.5）：
 * - 756 / 757 / 757.1：这类文本把对象指定为 Untargetable，正式句式即「[Game Object] can't
 *   be chosen by [Category] spells and abilities.」，CR 的官方范例逐字就是本卡
 *   （"Example: Ruin Runner's passive ability reads 'I can't be chosen by enemy spells and
 *   abilities.'"）。
 * - 758 / 758.1 / 758.2 / 758.2.a：不可被选中的对象不是合法目标；定案后、结算前才变为不可选
 *   的对象会 mistarget；同类法术/能力的范围变化会重新开放目标资格。研判与重验分别落在
 *   355.9.b（目标合法性）与 359.3.e.5（结算时重验）。
 * - 该能力是 Passive Ability（757），契约 3.1 的形状为 static 持续效果；本程序按调研表
 *   （docs/plans/survey/ability-templates.json 对 sfd-105-221 记的 continuous.restrict +
 *   target.filter）保留描述性声明，不重写目标规则。
 *
 * Current review:
 * CR v1.5 756/757.1 and 758/758.1: Untargetable is scoped to enemy
 * spells and abilities, and must be rechecked on resolution. Default static
 * binding and ChainEngine target legality hooks now exist. The enemy chooser
 * and source-category predicates still lack a rule-query adapter; this
 * descriptive declaration must not become an unconditional target prohibition.
 */
export default {
  canonicalCardId: "card.hash-4c33c3a92166927cee28b4acd0740603992c27aa8567488dee47edd7288ae1a1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I can't be chosen by enemy spells and abilities」是 CR v1.5 756/757.1、758/758.1 的分类 Untargetable。continuous.restrict 的默认 static 绑定已存在，ChainEngine.targetIsLegal 也已把 restrictions() 接到 target/target-plan.ts 的 Finalize/Resolve isLegal；剩余缺口是 enemy chooser 与 spell/ability sources 的类别条件。当前 static 的 mode:untargetable/chooser/sources 不会转成 actions/具来源限定的 restriction，rules/query.ts 也不判定这些字段；一条无条件 target 禁止会误伤友方效果。依赖：选择者相对来源控制者及来源类别的限制表示、查询与目标重验适配。",
  abilities: [
    {
      kind: "static",
      effect: {
        // 757/757.1：把宿主指定为 Untargetable；「enemy」限定选择者为对手，
        // 「spells and abilities」限定来源类别。字段是描述性数据，不是可执行原语调用。
        kind: "continuous.restrict",
        mode: "untargetable",
        appliesTo: "self",
        chooser: "opponent",
        sources: ["spell", "ability"]
      }
    }
  ],
  sourceText: "I can't be chosen by enemy spells and abilities."
} satisfies CardProgram;
