import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * Baccai Witherclaw (ven-078-166) — Unit, 4 Energy, 4 Might, Body, Shurima
 * （无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-078-166，逐字）：
 *   [Empower] :rb_energy_1::rb_rune_rainbow::rb_rune_rainbow:
 *   (:rb_energy_1::rb_rune_rainbow::rb_rune_rainbow:: Empower me. Use only if not
 *   Empowered.)
 *   [Empowered][>] I have +2 :rb_might:.
 *   [Empowered][>][>>][Deathknell][>] Channel 2 runes exhausted. (When I die
 *   while Empowered, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - 827.1 / 827.1.c.1：[Empower] 是启动能力关键词；“仅当未 Empowered 时启动”。
 *   827.1.c.2 允许费用同时包含资源与非资源费用；本卡印刷费用为 1 Energy 与两个
 *   :rb_rune_rainbow:（任意域 Power [A]，135.2.e.5.a / 163.2.b；butcher-of-the-sands
 *   已验证合并费用管线可用该形状支付）。
 * - 828.1.a / 828.1.b.1：[Empowered][>] 是依赖型关键词，整段功能等价于“当我拥有
 *   Empowered 状态时，此牌获得 [Text]”。
 * - 727.1.b.3：[Empowered][>>][Deathknell] 是两个 Dependent Keyword 叠加，只有
 *   Empowered 条件成立时后面的 Deathknell 能力才 Active；因此 [Empowered] 在这里
 *   不作为独立关键词声明（那会错误地表达为“本牌始终拥有 Deathknell”），而写成带
 *   Empowered 门槛的显式触发能力（与 ven-128-166 Noxian Emissary 同形）。
 * - 808.1.c：Deathknell 功能上等同 “When I die, [Effect].”；808.1.d / 429.1.a.1.b：
 *   触发点是自身被消灭，封闭时点为 object-killed。
 * - 431.1 / 431.2：“Channel 2 runes exhausted” 用 effect.channel（amount 2、
 *   exhausted true），431.2 的官方例子正是 “Channel 1 rune exhausted”。
 *
 * status = judge-required（四处缺口均不近似实现）：
 * 1. keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，
 *    827.1.c.1 的启动费用与“仅当未 Empowered 时”限制、828.1.b.1 的依赖能力都无法展开；
 * 2. 费用里的两个 :rb_rune_rainbow: 是任意域 Power [A]，费用管线的支付形状已合入
 *    （两条各 1 点、allowedDomains 覆盖六域的需求，与 butcher-of-the-sands 同形），
 *    但 Empower 关键词本身缺 KeywordDef，印刷费用仍没有进入起动能力的展开路径；
 * 3. 没有 Empowered 状态谓词（442.1.a）：ObjectSnapshot 没有该字段（测试内核的
 *    empowered 计数不进入快照），condition.predicate 无法求值（RIFT-359）。727.1.c.1
 *    的“依赖能力在宿主死亡瞬间仍 Active”没有判定路径；当前
 *    programs/filters.ts 的 translateTriggerFilter 对 self 锚点会成功生成自身匹配，
 *    但会丢弃同一过滤里的 empowered / cause / destination 字段，因此 Empowered
 *    门控与死亡事件的因果/去向限制没有进入运行时匹配（该支持属于 RIFT-359 的条件谓词）；
 * 4. channel-rune 动作未落实 431.2 的进入状态：effect.channel 会把 exhausted: true 作为
 *    规定提交，但已合入的参考内核忽略该字段（符文仍以就绪状态进入符文区）。
 * 依赖新的 Empower/Empowered 关键词任务、RIFT-359（条件谓词）与内核补齐 431.2。
 * “Channel 2 runes exhausted” 的 effect.channel 本体已合入，golden 用参考内核真实执行
 * 该子效果。
 */

/** 442.1.a / 828.1.c / 727.1.b.3：Empowered 门槛（描述性谓词，见 judgeReason）。 */
const empoweredGate: Condition = {
  kind: "compare",
  left: { kind: "object-property", object: "self", property: "empoweredCount" },
  operator: "gte",
  right: { kind: "constant", value: 1 }
};

const abilities: Ability[] = [
  {
    // 印刷费 1 Energy + 两个 [A] Power 见 judgeReason；KeywordAbility 没有承载费用
    // 的字段，不伪造启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>]「I have +2 :rb_might:」（143.2.a 的算术图层修正）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      appliesTo: "self"
    },
    condition: empoweredGate
  },
  {
    // [Empowered][>>][Deathknell][>] 的依赖能力：727.1.b.3 要求 Empowered 条件成立时
    // 该 Deathknell 才 Active；过滤里的 empowered: true 是该门槛的描述性记录
    // （没有可求值的谓词，见 judgeReason 第 3 条）。
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: { self: true, empowered: true, cause: "kill", destination: "trash" }
    },
    optional: false,
    body: [
      {
        // 431.1 / 431.2：“Channel 2 runes exhausted”。
        id: "baccai-witherclaw.channel-2-exhausted",
        op: "effect.channel",
        args: {
          amount: { kind: "constant", value: 2 },
          exhausted: { kind: "constant", value: true }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-3a9686028c1c8883834ec636779521dcd144e90d07dbc34d923dc7533699ba4d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef：827.1.c.1 的" +
    "「1 Energy + 两个 :rb_rune_rainbow:：Empower me，仅当未 Empowered 时启动」与 828.1.b.1 的依赖能力" +
    "都无展开实现（依赖新的 Empower/Empowered 关键词任务）；(2) 费用里的 :rb_rune_rainbow: 是任意域 Power" +
    " [A]（135.2.e.5.a、163.2.b），费用管线的支付形状已合入（两条各 1 点、allowedDomains 覆盖六域，" +
    "与 butcher-of-the-sands 同形），但 Empower 本体缺 KeywordDef、印刷费用仍没有进入起动能力的展开路径；" +
    "(3) 没有 Empowered 状态谓词——442.1.a 的状态不在 ObjectSnapshot / Condition 里（测试内核的" +
    " empowered 计数不进入快照），727.1.b.3 的「Empowered 成立时后面的 Deathknell 才 Active」与" +
    " 727.1.c.1 的死亡瞬间判定都不可求值；当前 programs/filters.ts 的 translateTriggerFilter 对" +
    " self 锚点会成功生成自身匹配，却丢弃触发过滤里的 empowered / cause / destination 字段，" +
    " 所以 Empowered 门控与死亡事件的因果/去向限制没有进入运行时匹配（该支持属于 RIFT-359 的条件谓词）；" +
    "(4) 「Channel 2 runes exhausted」的进入规定（431.2）未落地：" +
    "effect.channel 会提交 exhausted: true 规定，但已合入的参考内核忽略该字段、符文仍以就绪状态进入。" +
    "channel 子效果本体已用参考内核真实执行；不近似实现。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_1::rb_rune_rainbow::rb_rune_rainbow: " +
    "(:rb_energy_1::rb_rune_rainbow::rb_rune_rainbow:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +2 :rb_might:.\n" +
    "[Empowered][>][>>][Deathknell][>] Channel 2 runes exhausted. (When I die while " +
    "Empowered, get the effect.)"
} satisfies CardProgram;
