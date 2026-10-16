import type { CardProgram } from "../../ir/index.js";

/**
 * Rage Amplifier (ven-018-166) — Gear, 4 Energy, 1 Fury Power, Might null
 * (no printed Might), Fury, no tags.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, ven-018-166）：
 *   "[Empower] :rb_energy_6::rb_rune_fury: (:rb_energy_6::rb_rune_fury:: Empower
 *    this. Use only if not Empowered.)\n"
 *   "Your units have +1 :rb_might:. If I'm [Empowered], they have +2 :rb_might:
 *    instead."
 *
 * 规则依据（CR v1.5）：
 * - 827.1 / 827.1.a：Empower 是启动式能力关键词，印在永久物上；827.1.c 的格式是
 *   "Empower [Cost]"，本卡费用为 6 Energy + 1 Fury Power；827.1.c.1 功能等价于
 *   "[费用]：Empower this。仅当未 Empowered 时启动。" 827.1.b.1 明确来源本身不是目标。
 * - 442.1 / 442.2：Empower 动作把 Board 上的 Game Object 变为 Empowered；
 *   442.2.a 说明状态变化后其他效果可引用它。
 * - 828.1.a–828.1.c：[Empowered][>] 是 Dependent Keyword；从关键词到子句末尾整段是
 *   Empowered 能力（828.1.b），功能等价于"只要我拥有 Empowered 状态，此牌获得 [Text]"
 *   （828.1.b.1），并按 828.1.c 在该状态下 Active。
 * - "Your units have +1 [M]" / "they have +2 [M] instead"：364.2（陈述事实的被动能力）、
 *   365.1（永久物的被动能力在其停留在 Board 期间生效）、143.2.a（Effective Might 与
 *   arithmetic 图层，475/477）——这是持续的 Might 修正，属 layers 的 continuous.might；
 *   740.1.a 的 friendly 决定 "Your units" 指本卡控制者的单位。
 *   "instead" 表示 Empowered 时把 +1 整体替换为 +2，而不是叠加（同一句的两种取值）。
 *
 * status = judge-required（缺口逐个列出，均不近似实现）：
 * 1. effects/keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef：
 *    827.1.c.1 的起动费用（cost.activated + effect.empower + "仅当未 Empowered"限制）
 *    与 828.1.c 的状态门控都没有展开实现（RIFT-81~88 关键词批次不含它们）。
 * 2. Might 修正没有卡牌侧消费入口：契约的"static 能力 → layers"接线未合入
 *    （LayerEngine 只消费经 ResolveContext.addContinuous / registerContinuousEffect
 *    注册的 ContinuousEffectSpec，卡牌 static 能力没有注册方），所以 +1/+2 不会生效。
 * 3. "If I'm [Empowered]" 需要求值 Empowered 状态的谓词；冻结的 Condition 只有
 *    always/never/expression/compare/all/any/not，ObjectSnapshot 也不暴露 Empowered
 *    状态（engine-core effects/contract.ts 的 ObjectSnapshot 无该字段）。
 * 依赖：新增 Empower/Empowered 关键词任务、RIFT-91（layers 卡牌接线与状态谓词）。
 * 本程序只声明印刷事实（关键词 + 两条 continuous.might 取值），不手写状态判定，
 * 也不把 Empowered 分支平铺成无条件效果。
 */
/**
 * 827.1.c：印刷 "Empower 6 Energy + 1 Fury Power"。value 记印刷的 Energy 数量 6（同目录
 * ven/nasus-ascended 等 [Empower] 声明的既有口径），costDomain 记 Power 的领域（沿用
 * sfd/long-sword 的 Equip 扩展字段先例，契约 3.8.3 的 params.cost 通道未合入）。
 * costDomain / 该 Power 分量的承载方式见回复里的契约变更请求。
 */
const empower = {
  kind: "keyword",
  keyword: "empower",
  value: 6,
  costDomain: "Fury"
} as const;

export default {
  canonicalCardId: "card.hash-d253644e2551694bc909320c263dcb18818de02f076039f478f45ef0e36eff91",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) effects/keywords/registry.generated.ts 没有 Empower/Empowered 的 " +
    "KeywordDef（RIFT-81~88 批次不含），827.1.c.1 的起动费用（6 Energy + 1 Fury Power，来源非目标）" +
    "与 827.1.c.5 / 442.1.b 的『仅当未 Empowered』限制、以及 828.1.c 的 Dependent Ability 门控都无展开；" +
    "(2) 『Your units have +1 [M]』与 Empowered 时的 +2 [M] 是 arithmetic 层的 continuous.might " +
    "（143.2.a / 475 / 477），但契约 3.5/3.7 的『卡牌 static 能力 → layers』接线未合入：" +
    "LayerEngine 只消费经 ResolveContext.addContinuous / registerContinuousEffect 注册的 " +
    "ContinuousEffectSpec，卡牌程序没有注册方，修正不会生效；" +
    "(3) 『If I'm [Empowered]』缺可求值谓词：冻结的 Condition 只有 always/never/expression/compare/" +
    "all/any/not，ObjectSnapshot（engine-core effects/contract.ts）也不暴露 Empowered 状态。" +
    "依赖新增 Empower/Empowered 关键词任务与 RIFT-91（layers 卡牌接线、状态谓词）。" +
    "关键词与两条 Might 取值只按印刷事实声明，不把 Empowered 分支平铺成无条件效果。",
  abilities: [
    empower,
    {
      // 828.1.b.1 的默认分支：“Your units have +1 [M]”。
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        // 740.1.a："Your units" 是本卡控制者的单位；365.1：被动能力在其在 Board 期间生效。
        filter: { type: "unit", controller: "controller", zone: "board" },
        amount: { kind: "constant", value: 1 }
      },
      // 默认分支的适用条件是"未 Empowered"：828.1.b.1 的 Dependent Ability 只在
      // 拥有 Empowered 状态时 Active，所以 +1 分支与 +2 分支互斥。Empowered 状态
      // 谓词（828.1.c）当前没有可求值形状，只以具名谓词记录，不写成恒真或硬编码。
      condition: {
        kind: "not",
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "self-is-empowered" }
        }
      }
    },
    {
      // "…if I'm [Empowered], they have +2 [M] instead."："instead" 是把同一处的取值
      // 换成 +2（整体替换），不是再叠加一条 +1。insteadOf 只作评审标记，记录被替换的
      // 是上面那条默认分支；消费方仍然是图层按互斥条件求值，不存在额外语义。
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        insteadOf: { kind: "constant", value: "rage-amplifier-base-might" },
        filter: { type: "unit", controller: "controller", zone: "board" },
        amount: { kind: "constant", value: 2 }
      },
      condition: {
        kind: "expression",
        value: { kind: "constant", value: "self-is-empowered" }
      }
    }
  ],
  sourceText:
    "[Empower] :rb_energy_6::rb_rune_fury: (:rb_energy_6::rb_rune_fury:: Empower this. Use only if not Empowered.)\n" +
    "Your units have +1 :rb_might:. If I'm [Empowered], they have +2 :rb_might: instead."
} satisfies CardProgram;
