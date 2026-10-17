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
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：Deflect 展开与 target.tax 机制已合入
 * （target/target-plan.ts），图层注册入口也已有生产路径；早前把 RIFT-90/RIFT-91/87
 * 全列缺口的写法已过时。
 *
 * status = judge-required（当前真实缺口，均不近似实现）：
 * 1. 没有 Empower / Empowered 的 KeywordDef（keywords/registry.generated.ts 不含），
 *    827.1.c.1 的起动费用与 “Use only if not Empowered” 限制无法展开；
 * 2. 没有 Empowered 状态谓词（442.1.a），“[Empowered][>]” 的门控没有可求值形态；
 * 3. “+7 Might” 需要卡牌侧 continuous.might 注册/求值入口（RIFT-91 只合入图层求值侧）；
 * 4. [Deflect] 的展开文件已合入（static target.tax），但没有生产方把永久物上的 target.tax
 *    接进目标选择与追加费用，且 809.1.c.1 要求的任意域 Power（:rb_rune_rainbow:）在六域封闭
 *    Domain 集合下不可表示（RIFT-90/RIFT-89）。
 * 依赖：新增 Empower/Empowered 关键词任务、RIFT-90（目标税接线）、RIFT-89（任意域 Power 付费）、
 * RIFT-87（条件/谓词）、RIFT-91（layers 接线）。不近似实现：不把 Deflect 写成别的时点或数值，
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
    "缺口（复核 2026-10-17，均不近似实现）：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，" +
    "827.1.c.1 的“7 Energy：Empower me，仅当未 Empowered 时启动”无法展开（827.1.b.1：来源不是目标）；" +
    "(2) 没有 Empowered 状态谓词——442.1.a 的二元状态不在 ObjectSnapshot / Condition 里，828.1.b / 828.1.b.1" +
    " 的依赖能力门控没有可求值形态（+7 Might 的 arithmetic 图层产出可由已合入的 continuous.might 执行，" +
    "缺的只是 Empowered 门控与卡侧注册接线）；(3) [Deflect] 的展开（effects/keywords/Deflect.ts 的 static " +
    "target.tax）与 target/target-plan.ts 的税机制均已合入，但没有从永久物关键词自动接进目标计划的生产方" +
    "（tax 由调用方显式传入），且 809.1.c.1 要求的任意域 Power（:rb_rune_rainbow:）在六域封闭 Domain 集合下" +
    "不可表示。依赖：新的 Empower/Empowered 关键词任务、442.1.a 状态谓词、keyword→target.tax 自动接线、" +
    "任意域 Power 付费。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "[Empower] :rb_energy_7: (:rb_energy_7:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +7 :rb_might:."
} satisfies CardProgram;
