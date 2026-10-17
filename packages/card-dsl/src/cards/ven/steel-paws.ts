import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Steel Paws (ven-043-166) — Unit, Calm, 1 Energy, Might 0, tag Cat/Piltover.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-043-166，逐字）：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)
 *   [Empower] :rb_energy_7: (:rb_energy_7:: Empower me. Use only if not Empowered.)
 *   [Empowered][>] I have +7 :rb_might:.
 *
 * 规则依据（Core Rules v1.5）：
 * - 809.1 / 809.1.b.3 / 809.1.c / 809.1.c.1：[Deflect] 是 Passive Ability 关键词；
 *   省略数值即 1，功能等价于“对手的法术与能力每次选择我时，须额外支付 1 点任意域 Power”。
 *   按契约 3.7 卡牌只声明关键词，展开（static target.tax）归 effects/keywords/Deflect.ts。
 * - 827.1 / 827.1.c / 827.1.c.1：[Empower] 是启动能力关键词，本卡印刷费用 7 Energy，
 *   功能等价于 “[7 Energy]：Empower me。仅当未 Empowered 时启动。”；827.1.b.1 说明来源
 *   自身不是目标。展开归 keywords/（尚无 Empower KeywordDef）。
 * - 828.1.b / 828.1.b.1：[Empowered][>] 之后的整句是依赖能力，只在宿主 Empowered 时 Active；
 *   +7 Might 属 layers 的 arithmetic 层（143.2/143.2.a、479）。
 *
 * 复核（2026-10-17，RIFT-618 第三轮 M2 覆盖率复核；结论来自源码核对与本任务 golden，
 * 不采信历史任务号）：
 * - Empower KeywordDef 已合入（effects/keywords/Empower.ts + registry.generated.ts）：keywords/Empower.ts 会展开 827.1.c.1 的启动费用与 “Use only if not
 *   Empowered” 限制，但快照必须能读到 live `empowered` 计数。
 * - continuous.might 的算术图层求值与 [Deflect] 的 static target.tax 展开文件都已合入；
 *   本卡两个依赖能力如果没有门控，会在未 Empowered 时也生效。
 *
 * status = judge-required（当前真实缺口，均不近似实现）：
 * 1. 印刷的 7 Energy 无法到达 KeywordDef.expand：契约 3.1 的 KeywordAbility 只有
 *   keyword/value 字段，programs/keywords.ts 的 expandProgram 调用 def.expand({ value, host })
 *   时不传 params.cost，所以本任务实测展开出的启动费用是 { kind: "empower" } 而不是
 *   { kind: "activated", energy: 7 }；buildCostPlan 对 { kind: "empower" } 抛
 *   CostPlanError “Unsupported cost kind: empower”（费用管线没有 empower 付费种类）。
 *   value: 7 只记录印刷数值，不冒充费用。
 * 2. 没有 Empowered 状态谓词（442.1.a）：ObjectSnapshot 没有 empowered 字段，Condition
 *   词表也没有对应谓词，828.1.b/828.1.b.1 的门控只能用描述性 expression 占位。本任务
 *   实测：把该 condition 交给 layers/engine.ts 的 conditionMatches 时未知 kind 落回 true，
 *   注册路径又把卡内 condition 当函数求值，于是没有 Empowered 的对象也求解出 +7 Might。
 * 3. [Deflect] 的展开是 static target.tax，而 programs/statics.ts 的 layerFor() 对
 *   target.tax 没有图层映射，本任务实测 createEngineStaticBinder().bindStatic 抛
 *   ProgramBindingError “Static ability kind target.tax has no layer mapping”；因此没有
 *   生产方把永久物上的 target.tax 接进目标选择与追加费用（target/tax/collect.ts 只在
 *   调用方显式传入 effects 时收集）。
 *   [A]（:rb_rune_rainbow:，809.1.c.1 要求的任意域 Power）已由费用系统六域
 *   allowedDomains 表达（cost/kinds/hidden.ts、cost.pay 接受六域 payments），不再是缺口。
 * 依赖：KeywordAbility 印刷 Empower 费用传递（契约变更请求）、442.1.a 状态谓词、
 * keyword→target.tax 的图层/目标计划接线。不近似实现：不把 Deflect 写成别的时点或数值，
 * 也不把 +7 Might 写成 Buff 计数器。
 */
const abilities: Ability[] = [
  // 809.1.b.3：印刷省略 Deflect Value，按 1 处理（不写 value）。
  { kind: "keyword", keyword: "deflect" },
  // 827.1.c.1：印刷费 7 Energy；展开归关键词侧（见 judgeReason）。
  { kind: "keyword", keyword: "empower", value: 7 },
  {
    // 828.1.b.1 的依赖能力：宿主 Empowered 时获得 +7 Might。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 7 }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  }
];

export default {
  canonicalCardId: "card.hash-d1cb46188e07e26d280977537ff04f5a6daa76c60e4a224b15aa5a8c64b3b1aa",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三条当前缺口（复核 2026-10-17，RIFT-618；均以本任务实测为准，不近似实现）：" +
    "(1) 印刷的 7 Energy 无法到达 KeywordDef.expand（827.1.c.1）：KeywordAbility 只有 keyword/value，" +
    "programs/keywords.ts 调用 def.expand({ value, host }) 时不传 params.cost，实测展开出的启动费用是 " +
    "{ kind: \"empower\" }；buildCostPlan 对该 kind 抛 CostPlanError \"Unsupported cost kind: empower\"，" +
    "费用管线仍无 empower 付费种类；value: 7 只记录印刷数值，不当费用。" +
    "(2) 没有 Empowered 状态谓词（442.1.a）：ObjectSnapshot 无 empowered 字段、Condition 词表无该谓词，" +
    "828.1.b.1 的门控只能用描述性 expression 占位；实测 layers/engine.ts 的 conditionMatches 对未知 kind 落回 true，" +
    "未 Empowered 的对象也求解出 +7 Might。" +
    "(3) [Deflect] 展开为 static target.tax，但 programs/statics.ts 的 layerFor() 无该映射：实测 " +
    "createEngineStaticBinder().bindStatic 抛 \"Static ability kind target.tax has no layer mapping\"，" +
    "没有生产方把永久物上的 target.tax 接进目标选择与追加费用（target/tax/collect.ts 只在调用方显式传入 effects 时收集）。" +
    "已合入且非缺口：Empower/Empowered 的 KeywordDef已注册、continuous.might 的算术图层可求值、" +
    "[A]（809.1.c.1）由六域 allowedDomains 表达。依赖：KeywordAbility 印刷 Empower 费用传递（契约变更请求）、" +
    "442.1.a 状态谓词、keyword→target.tax 的图层/目标计划接线。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "[Empower] :rb_energy_7: (:rb_energy_7:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +7 :rb_might:."
} satisfies CardProgram;
