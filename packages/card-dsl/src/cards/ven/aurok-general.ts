import type { CardProgram } from "../../ir/index.js";

/**
 * Aurok General (ven-130-166) — Unit, 5 Energy, 5 Might, Order, Trifarian/Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-130-166，逐字）：
 *   [Empower] :rb_energy_3::rb_rune_order: (:rb_energy_3::rb_rune_order::
 *   Empower me. Use only if not Empowered.)
 *   [Empowered][>] Your units that are [Empowered] have +2 :rb_might: (including me).
 *
 * 规则依据（CR v1.5）：
 * - 827.1/827.1.c.1：[Empower] 是启动能力关键词，功能等价于
 *   “[3 Energy + 1 Order Power]：Empower me。仅当未 Empowered 时启动。”
 * - 828.1.a/828.1.b.1：[Empowered][>] 依赖型关键词，整段功能等价于“当我拥有
 *   Empowered 状态时，此牌获得 [Text]”。
 * - “Your units that are [Empowered] have +2 [M]”：Empowered 单位的 Might 修正是
 *   图层算术层（479 的 layers 顺序、contract 3.4），作用范围为自己控制的所有
 *   Empowered 单位（含宿主）。
 *
 * status = judge-required（三处缺口均不近似实现）：
 * 1. 没有 Empower / Empowered 的 KeywordDef（keywords/registry.generated.ts 只含
 *    RIFT-81~88 批次的 Assault/Shield/Deathknell/Legion/Ganking/Vision/Deflect/
 *    Hidden/Action/Reaction/Repeat/Accelerate/Equip/Quick-Draw/Weaponmaster/Mighty），
 *    827.1.c.1 的费用与“仅当未 Empowered 时”限制、828.1.b.1 的依赖能力无法展开；
 * 2. 没有 Empowered 状态谓词（442.1.a）：静态效果的 filter 里 `empowered: true`
 *    是描述性记录，没有可求值的谓词；
 * 3. 没有卡牌侧的 continuous.might 静态效果消费入口（RIFT-91 的 layers 引擎已合入，
 *    但 effects/instructions 没有对应的注册/求值原语，ctx.addContinuous 也只有
 *    chain/engine 内部接线）。
 * 依赖新的 Empower/Empowered 关键词任务、RIFT-87（条件/谓词）、RIFT-91（layers 接线）。
 */
export default {
  canonicalCardId: "card.hash-74533231e291deb55f594e5f04b19faf248214fac82769433d2d3387166f0bad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，" +
    "827.1.c.1 的“3 Energy + 1 Order Power：Empower me，仅当未 Empowered 时启动”无法展开；" +
    "(2) 没有 Empowered 状态谓词——442.1.a 的二元状态不在 ObjectSnapshot / Condition 里，" +
    "静态效果 filter 中的 `empowered: true` 只是描述性记录；(3) 没有卡牌侧的 continuous.might" +
    "静态效果消费入口（RIFT-91 的 layers 引擎已合入，但 effects/instructions 下没有对应原语，" +
    "ctx.addContinuous 只有 chain/engine 内部接线），828.1.b.1 的依赖能力也因此不能激活。" +
    "依赖新的 Empower/Empowered 关键词任务、RIFT-87（条件/谓词）与 RIFT-91（layers 接线）。" +
    "不近似实现（例如不把 +2 :rb_might: 写成 Buff）。",
  abilities: [
    {
      // 印刷费 3 Energy + 1 Order Power 见 judgeReason；不伪造启动能力。
      kind: "keyword",
      keyword: "empower"
    },
    {
      // [Empowered][>] 的依赖能力：Empowered 状态门槛（442.1.a / 828.1.b.1）与
      // 图层算术修正（479、contract 3.4）。
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 2 },
        filter: {
          type: "unit",
          zone: "board",
          controller: "controller",
          empowered: true
        }
      }
    }
  ],
  sourceText:
    "[Empower] :rb_energy_3::rb_rune_order: (:rb_energy_3::rb_rune_order:: Empower me. " +
    "Use only if not Empowered.)\n[Empowered][>] Your units that are [Empowered] have " +
    "+2 :rb_might: (including me)."
} satisfies CardProgram;
