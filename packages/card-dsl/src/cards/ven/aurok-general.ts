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
 * 复核（2026-10-17，第一轮 M2 覆盖率复核）：原第 3 条已解决——continuous.might 指令原语
 * 随 RIFT-258 合入（effects/instructions/continuous.might.ts，注册表可见），它按 478
 * 的算术图层把 Might 修改通过 ctx.addContinuous 注册给 layers 引擎；golden 真实执行该形状
 * 并断言注册与有效 Might。
 *
 * status = judge-required（两条缺口，均属 Empower/Empowered 依赖）：
 * 1. 没有 Empower / Empowered 的 KeywordDef（keywords/registry.generated.ts 的已合入批次
 *    只含 Assault/Shield/Deathknell/Legion/Ganking/Vision/Deflect/Hidden/Action/Reaction/
 *    Repeat/Accelerate/Equip/Quick-Draw/Weaponmaster/Mighty/Tank/Backline/Temporary/Hunt/
 *    Ambush/Flow/Deploy/Disarm/Level/Show Off），827.1.c.1 的“3 Energy + 1 Order Power：
 *    Empower me，仅当未 Empowered 时启动”无法展开；
 * 2. 没有 Empowered 状态谓词（442.1.a）：ObjectSnapshot 只有 might/energy/power/
 *    exhausted/damage/stunned/buffs/attachedTo/faceDown，没有该二元状态；Condition 也没有
 *    对应分支，layers/engine.ts 的 conditionMatches 对未知 kind 落回 true——因此静态效果的
 *    filter 里 `empowered: true` 是描述性记录（layers/filter.ts 同样忽略未知键），
 *    828.1.b.1 的依赖能力不是可执行门控。
 * 依赖新的 Empower/Empowered 关键词任务与 442.1.a 的状态谓词。不近似实现（例如不把 +2 [M]
 * 写成 Buff，也不把依赖能力改成无条件能力）。
 */
export default {
  canonicalCardId: "card.hash-74533231e291deb55f594e5f04b19faf248214fac82769433d2d3387166f0bad",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两条缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，" +
    "827.1.c.1 的“3 Energy + 1 Order Power：Empower me，仅当未 Empowered 时启动”无法展开；" +
    "(2) 没有 Empowered 状态谓词——442.1.a 的二元状态不在 ObjectSnapshot / Condition 里，" +
    "layers/engine.ts 的 conditionMatches 对未知 condition kind 落回 true、layers/filter.ts 忽略未知过滤键，" +
    "所以静态效果 filter 中的 `empowered: true` 只是描述性记录，828.1.b.1 的依赖能力不是可执行门控。" +
    "continuous.might 指令原语已随 RIFT-258 合入（golden 真实执行 +2 [M] 的注册与算术图层结果），" +
    "缺的只是 Empowered 门控本身。依赖新的 Empower/Empowered 关键词任务与 442.1.a 的状态谓词。" +
    "不近似实现（不把 +2 :rb_might: 写成 Buff，也不把依赖能力改成无条件能力）。",
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
