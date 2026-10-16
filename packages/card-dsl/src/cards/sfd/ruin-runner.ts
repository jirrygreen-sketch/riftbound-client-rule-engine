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
 * - 没有已合入的消费者：effects/instructions/ 里没有 continuous.restrict 这类原语，layers/ 只
 *   消费算术、关键词与移动图层（layers/engine.ts 的 applyAbility/applyArithmetic），
 *   target/target-plan.ts 的合法性检查只读过滤器与 Pending 状态，不读取任何「不可被选中」声明。
 * - 也没用可表达的过滤器形状：不可被选中是「对手的法术/能力不能选择我」，需要在目标合法性检查
 *   时同时知道选择者的身份与「法术或能力」这一来源类别；冻结 ObjectFilter 只有 controller/owner
 *   等对象特征键，TargetSpec 侧也没有「选择者类别」字段，因此不把该效果写成卡自己的 filter 键
 *   （那样会静默失效）。
 * - 因此整卡不宣称 executable；不给该能力发明简化语义（例如「不能被任何效果选择」会放宽到
 *   连友方效果也不能选，与 757 的 [Category] 限定不符）。
 * 依赖：continuous.restrict 与目标合法性/重验的消费方（RIFT-90/RIFT-91）。
 */
export default {
  canonicalCardId: "card.hash-4c33c3a92166927cee28b4acd0740603992c27aa8567488dee47edd7288ae1a1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I can't be chosen by enemy spells and abilities」是 756/757/757.1 的 Untargetable 被动能力" +
    "（CR 官方范例逐字就是本卡），但没有任何已合入的消费方：effects/instructions/ 没有 continuous.restrict " +
    "原语，layers/ 只消费算术/关键词/移动图层，target/target-plan.ts 的合法性检查只读过滤器与 Pending 状态，" +
    "不读「不可被选中」声明；758/758.1/758.2 要求的定案合法性（355.9.b）与结算重验（359.3.e.5）因此无从落地。" +
    "也没有可表达的过滤器形状：该限制需要同时知道选择者身份与「法术或能力」这一来源类别，冻结 ObjectFilter " +
    "只有对象特征键、TargetSpec 无「选择者类别」字段，故不把效果写成会静默失效的 filter 键。" +
    "本卡保留描述性 static 声明（调研表记为 continuous.restrict + target.filter），不近似实现" +
    "（放宽成「不能被任何效果选择」会超出 757 的 [Category] 限定）。" +
    "依赖：continuous.restrict 与目标合法性/重验消费方（RIFT-90 / RIFT-91）。",
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
