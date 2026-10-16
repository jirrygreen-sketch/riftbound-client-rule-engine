import type { CardProgram } from "../../ir/index.js";

/**
 * Navori Scout (sfd-037-221) — Unit, 4 Energy, 力量未印刷，Might 4，
 * Calm，标签 Yordle/Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-037-221，逐字）:
 *   "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell
 *   or ability.)"
 *
 * 规则依据（CR v1.5）:
 * - 809.1.a：Deflect 是永久物上的被动能力关键词；809.1.b.3：省略数值时按 1
 *   处理，因此卡内只声明不带 value 的 keyword 能力（默认值由关键词文件展开）；
 * - 809.1.c / 809.1.c.1：对手的咒语/能力每次选择我时追加等量 Power 费用，
 *   该费用可用任意域支付；
 * - 809.1.d：这是对选择该对象的咒语/能力施加的强制追加费用；
 * - 809.2：多个 Deflect 数值相加；809.3：是否拥有 Deflect 是可被引用的特征。
 *
 * 卡牌只声明关键词（契约 3.1/3.7、README 第 5 节）；展开（static target.tax）由
 * engine-core 的 effects/keywords/Deflect.ts 负责。
 *
 * status = judge-required：展开文件已合入，但没有生产方把永久物上的 target.tax
 * 持续效果接进目标选择（target/target-plan.ts 只在调用方显式传入 tax 时追加，
 * 链的 Finalize 未从图层读取该静态效果），且已合入的 tax→费用换算按 Energy
 * 记账（chain/engine.ts），与 809.1.c.1 要求的「任意域 Power」不符。缺 RIFT-90
 * （目标税接线）与 RIFT-89（费用支付）；不近似实现。
 */
const navoriScout = {
  canonicalCardId:
    "card.hash-c75d6f4a1bbeb87090ae0f7135aac4f6a4f1062063662b9ccae6fe99f1c9bc7d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The merged Deflect expansion (effects/keywords/Deflect.ts: static target.tax) " +
    "has no producer wiring a permanent's target.tax continuous effect into target " +
    "selection: target/target-plan.ts appends the tax only from an explicit " +
    "TargetFinalizeOptions.tax supplied by the caller, and the chain Finalize never " +
    "derives it from layers. The merged tax-to-cost conversion also bills Energy " +
    "(chain/engine.ts) whereas 809.1.c / 809.1.c.1 require the additional Power to be " +
    "payable with any Domain. Depends on RIFT-90 (target tax into TargetPlan / cost " +
    "plan) and RIFT-89 (payment); not approximated.",
  abilities: [{ kind: "keyword", keyword: "deflect" }],
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

export default navoriScout;
