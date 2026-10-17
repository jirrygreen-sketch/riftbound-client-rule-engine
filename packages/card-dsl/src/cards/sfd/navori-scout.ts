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
 * status = judge-required：Deflect 展开与 RIFT-257/349 卡牌绑定均已合入，但 RIFT-349
 * 的 static 绑定对 target.tax 没有图层映射（Static ability kind target.tax has no layer
 * mapping），仍缺两层消费方：(1) 没有生产方把永久物 static 的 target.tax 接入目标选择——
 * target/target-plan.ts 只在调用方显式传入 tax 时追加，链的 Finalize 未从图层读取；
 * (2) 该目标税按 809.1.c.1 应可用任意域 Power 支付，链的 Finalize 目前把税记成
 * Energy 常量（chain/engine.ts 的 target-tax mandatoryAdditional）。不近似实现。
 */
const navoriScout = {
  canonicalCardId:
    "card.hash-c75d6f4a1bbeb87090ae0f7135aac4f6a4f1062063662b9ccae6fe99f1c9bc7d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "The Deflect expansion (effects/keywords/Deflect.ts: static target.tax) and the RIFT-257/349 " +
    "card binding are merged, but the RIFT-349 static binder has no layer mapping for target.tax, " +
    "so the tax still has no production consumer: " +
    "target/target-plan.ts appends it only from an explicit TargetFinalizeOptions.tax, and the " +
    "chain Finalize never derives it from layers. The chain also books the target tax as an " +
    "Energy constant (chain/engine.ts mandatoryAdditional), while 809.1.c.1 requires any-Domain " +
    "Power. Depends on RIFT-90 (target tax into TargetPlan); not approximated.",
  abilities: [{ kind: "keyword", keyword: "deflect" }],
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)"
} satisfies CardProgram;

export default navoriScout;
