import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ambessa, The Wolf (ven-084-166) — Unit, 4 Energy, Might 4, Body,
 * tags Noxus/Ambessa/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-084-166，逐字）：
 *   [Empower] :rb_energy_3::rb_rune_body: (:rb_energy_3::rb_rune_body::
 *   Empower me. Use only if not Empowered.)
 *   [Empowered][>] I have +3 :rb_might: and can't be dealt damage unless I'm in
 *   combat.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c.1：[Empower] 是 Activated Ability 关键词，功能等价于
 *   “[3 Energy + 1 Body Power]：Empower me。仅当未 Empowered 时启动。”印刷费用含 Power，
 *   KeywordAbility 没有费用字段（契约 3.8.3 的 params 只加在 KeywordDef.expand 的输入上），
 *   因此同 ven-128-166 / ven-136-166 的写法只声明关键词身份。
 * - 828.1.a / 828.1.b.1：[Empowered][>] 是 Dependent Keyword，从关键词到句末整段是依赖能力，
 *   功能等价于“当我拥有 Empowered 状态时，此牌获得 [Text]”。
 * - 442.1 / 442.1.a：Empowered 是 Board 上对象的二元状态。
 * - “+3 :rb_might:”是算术图层的 Might 增加（143.2.a、479.4.e.1），不是 Buff 计数器（702/703）。
 * - “can't be dealt damage unless I'm in combat”是防止伤害的替代效果（369.1 的 would/instead、
 *   369.2/438.7：Prevent 是 Delayed Replacement Effect）：战斗外的伤害事件被替换为“什么也不发生”。
 *   替代效果在动作执行前拦截（契约 3.5 的 GameAction 层），卡程序只能声明被替代的事件形状。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，四处缺口见 judgeReason，
 * 不近似实现（不把 +3 Might 写成 Buff，不把伤害防止写成伤害减免数值，也不用别的时点代替 Empowered）。
 */
const abilities: Ability[] = [
  {
    // 印刷费 3 Energy + 1 Body Power 见 judgeReason 第 1 条；不伪造启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>] 的 “I have +3 :rb_might:”：算术层 Might 增加（479.4.e.1）。
    // 依赖能力的门槛是 828.1.c 的 Empowered 状态；442.1.a 的二元状态不在 ObjectSnapshot /
    // Condition 里，condition 里的 empoweredCount 只是描述性记录（见 judgeReason 第 2 条）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 3 }
    },
    condition: {
      kind: "compare",
      left: {
        kind: "object-property",
        object: "self",
        property: "empoweredCount"
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  },
  {
    // “can't be dealt damage unless I'm in combat”：战斗外伤害的防止替代
    // （369.1/369.2/438.7）。空 with 表示事件被替换为不发生的动作（同 ogn-189-298
    // Kayn, Unleashed 的写法）；filter 的 combat: false 读伤害动作的 combat 分类
    //（契约 3.6 的 damage 动作带 combat 标记）。
    kind: "replacement",
    replaces: {
      event: "damage",
      filter: {
        // “dealt damage to me”：受伤害者是本卡自身（359.3.f 的来源指代）。
        target: "self",
        // “…unless I'm in combat”：只有非战斗伤害被防止（combat: false）。
        combat: false
      }
    },
    condition: {
      kind: "compare",
      left: {
        kind: "object-property",
        object: "self",
        property: "empoweredCount"
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    },
    with: []
  }
];

export default {
  canonicalCardId: "card.hash-e8452b3b9f2d2d608a43289045ddea899510d5650e10a3ffaf7066b5484d0f49",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，827.1.c.1 的" +
    "“3 Energy + 1 Body Power：Empower me，仅当未 Empowered 时启动”无法展开（依赖新的 Empower/Empowered" +
    "关键词任务；RIFT-83/84 批次不含它们）；(2) 没有 Empowered 状态谓词——442.1.a 的二元状态不在 " +
    "ObjectSnapshot / Condition 里，两条依赖能力（828.1.b.1）的门槛不可求值，程序里的 empoweredCount " +
    "只是描述性记录（依赖 RIFT-87 条件/谓词）；(3) 卡牌侧的 continuous.might 没有注册/求值原语，" +
    "“I have +3 :rb_might:”无法产生图层修正（RIFT-91 只合入 layers 引擎，卡牌入口缺失）；" +
    "(4) “can't be dealt damage unless I'm in combat”是 438.7 的伤害防止替代，但合并代码没有把 CardProgram 的" +
    "replacement 能力注册成 ReplacementRegistration 的消费方（events/pipeline.ts 需要调用方提供 matches/apply；" +
    "RIFT-120 之后的 card-program 适配器未合入），伤害动作的 combat 分类也未接到该注册面。" +
    "不近似实现（不把 +3 Might 写成 Buff 计数器，也不把防止伤害改成数值减免）。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3::rb_rune_body: (:rb_energy_3::rb_rune_body:: Empower me. " +
    "Use only if not Empowered.)\n" +
    "[Empowered][>] I have +3 :rb_might: and can't be dealt damage unless I'm in combat."
} satisfies CardProgram;
