import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Escaped Grayback (ven-124-166) — Unit, 3 Energy, Might 3, Order, tag Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-124-166，逐字）：
 *   [Empower] — Kill a friendly unit (Pay the cost: Empower me. Use only if not
 *   Empowered.)
 *   [Empowered][>] I have +2 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 827.1 / 827.1.b / 827.1.c / 827.1.c.1 / 827.1.c.2：[Empower] 是启动能力关键词，
 *   本卡印刷形态为 "Empower — Kill a friendly unit"，功能等价于「[Kill 一个友方单位]：
 *   Empower 我。仅当未 Empowered 时启动」；827.1.c.2 明确 Empower 费用可以同时包含资源
 *   与非资源费用，"Kill a friendly unit" 就是其中的非资源分量（429.6 的 Kill 格式）；
 *   827.1.b.1 明确来源自身不是目标。按契约 3.7 与 README 第 5 节只声明关键词，
 *   不重写展开（印刷费用与付费种类见 judgeReason）。
 * - 429.1 / 429.6：Kill 把永久物送进其拥有者的 Trash；"a friendly unit" 是控制者选择的
 *   对象（355.10.c：作为费用一部分的游戏对象不是目标），对应 cost/plan-values.ts 的
 *   nonstandard payment kinds 中的 "kill"。
 * - 828.1 / 828.1.b / 828.1.b.1 / 828.1.c：[Empowered][>] 是依赖关键词，整段功能等价于
 *   「当我拥有 Empowered 状态时，此牌获得 [Text]」。
 * - 143.2 / 143.2.a："+2 :rb_might:" 是算术图层的 Might 修正（475–477），不是 702 的
 *   Buff 计数器。
 *
 * status = judge-required（两处 Empower 语义缺口，均不近似实现）：
 * 1. 没有 Empower / Empowered 的 KeywordDef，827.1.c.1 的「[Kill 一个友方单位]：Empower 我，
 *    仅当未 Empowered 时启动」没有展开实现，也未绑定印刷的非资源 Kill 费用；
 * 2. 没有 Empowered 状态谓词（442.1.a）：状态不在 ObjectSnapshot / Condition 里，静态效果的
 *    condition 只能以显式谓词字符串占位；
 * 关键词授予的 +2 Might 本体用已合入的图层引擎（createLayerEngine）在 golden 中真实
 * 求值：这是「该 declared 静态形状在图层里确实产出 +2」的证据，不是整卡证据。
 */
const abilities: Ability[] = [
  {
    // 印刷费「Kill a friendly unit」见 judgeReason；KeywordAbility 没有 params 字段
    // （契约 3.8.3 的 params 只加在 KeywordDef.expand 的输入上），不伪造第二条启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>] I have +2 :rb_might:.
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      appliesTo: "self"
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-873c8f0234994082b765c3eb70f58d38ed667f83edf9a43739a2a1f28910a0f5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Empower / Empowered KeywordDef：827.1.c.1 的启动能力、827.1.c.2 的印刷 Kill 费用及未 Empowered 限制尚未展开绑定；" +
    "还缺 Empowered 状态谓词（442.1.a/828.1.b.1），不能门控静态 continuous.might。",
  abilities,
  sourceText:
    "[Empower] — Kill a friendly unit (Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +2 :rb_might:."
} satisfies CardProgram;
