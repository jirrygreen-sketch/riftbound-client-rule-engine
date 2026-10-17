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
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 原语已合入：RIFT-259 的 continuous.restrict（effects/instructions/continuous.restrict.ts）
 *   注册 ability 层的限制行，layers/rules/query.ts 也提供 restrictions() 查询（355.9.b 的
 *   目标合法性可由它承载）。
 * - 但没有消费者：target/target-plan.ts 的合法性检查（isLegal / 过滤器 + Pending）不调用
 *   layers/rules，chain/engine.ts 的 Finalize 也只校验 ChainDraft 的 requirements/restrictions；
 *   且注册路径仍是调用方提供的 ProgramStaticBinder 回调（programs/statics.ts 默认 noop，
 *   生产路径无调用者）。
 * - 本卡的声明形状也不是原语参数：程序写 mode/appliesTo/chooser/sources，而原语消费
 *   mode/action/appliesTo/restriction；「chooser 只能是选择者身份、sources 只能是「法术或能力」
 *   类别」这两个维度在冻结 ObjectFilter 与 TargetSpec 里都没有对应键，写进 filter 会静默失效。
 * - 因此整卡不宣称 executable；不给该能力发明简化语义（例如「不能被任何效果选择」会放宽到
 *   连友方效果也不能选，与 757 的 [Category] 限定不符）。
 * 依赖：continuous.restrict 的注册消费方与目标合法性/重验消费方（RIFT-90/RIFT-91 之后仍缺），
 * 以及「选择者身份 + 来源类别」的目标合法性维度。
 */
export default {
  canonicalCardId: "card.hash-4c33c3a92166927cee28b4acd0740603992c27aa8567488dee47edd7288ae1a1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I can't be chosen by enemy spells and abilities」是 756/757/757.1 的 Untargetable 被动能力" +
    "（CR 官方范例逐字就是本卡）。RIFT-259 已合入 continuous.restrict 原语与 layers/rules/query.ts 的 " +
    "restrictions() 查询，但仍没有消费方，且不近似实现：" +
    "(1) target/target-plan.ts 的合法性检查只读过滤器与 Pending 状态，不调用 layers/rules；chain/engine.ts 的 Finalize " +
    "也只校验 ChainDraft 的 requirements/restrictions，因此 758/758.1/758.2 的定案合法性（355.9.b）与结算重验（359.3.e.5）无从落地；" +
    "(2) 注册路径仍是调用方提供的 ProgramStaticBinder 回调（programs/statics.ts 默认 noop），生产路径无调用者把 " +
    "CardProgram static 能力注册成 ContinuousEffectSpec；" +
    "(3) 本卡声明形状与原语参数不同：程序写 mode/appliesTo/chooser/sources，原语消费 mode/action/appliesTo/restriction，" +
    "而「选择者是敌方」与「来源是法术或能力」这两个维度在冻结 ObjectFilter 与 TargetSpec 里都没有键，写进 filter 会静默失效。" +
    "依赖：continuous.restrict 的注册消费方与目标合法性/重验消费方（RIFT-90/RIFT-91 之后仍缺），" +
    "以及「选择者身份 + 来源类别」的目标合法性维度。",
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
