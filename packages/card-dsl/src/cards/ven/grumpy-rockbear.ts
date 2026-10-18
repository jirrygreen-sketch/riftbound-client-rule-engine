import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Grumpy Rockbear (ven-050-166) — Unit, Mind, Shurima.
 *
 * 原文：
 *   [Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune
 *   you control. (Pay the cost: Empower me. Use only if not Empowered.)
 *   [Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay
 *   :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while
 *   I'm a defender.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1：Empower 是 Activated Ability 关键词；827.1.c 规定格式 "Empower
 *   [Cost]"，本卡印刷费用为 12 Energy。827.1.c.3 明确 Empower 能力也可以带有修改
 *   Empower 费用的文本，任何需要确定该卡 Empower 费用的场合都要计入；206.1 说明
 *   需要判定某个能力费用时使用它的基础费用，除非文本另行说明——本卡正是"另行说明"，
 *   所以 "This ability costs 1 less for each rune you control" 是这条 Empower
 *   起动费用的一部分，不是独立效果。
 *   契约 3.8.3 把 params 放在 KeywordDef.expand 的输入上（供关键词注册表承载印刷
 *   参数），而契约 3.1 的 CardProgram KeywordAbility 只有 keyword / value 两个
 *   字段，卡程序无法把印刷参数直接挂在该能力上（TS 严格类型会拒绝）。因此这里把
 *   印刷费用 12 留在 keyword，把费用改写写成一条指向该 Empower 费用的 static 持续
 *   效果（appliesTo: "empower-activation-cost"、per: "rune-you-control"），由
 *   关键词 / 费用系统消费；不改 IR 类型，并在任务回复里登记该参数承载方式的契约
 *   变更请求。
 * - 442.1/442.2：Empower 把 Board 上的 Game Object 变为 Empowered；827.1.b.1
 *   规定来源本身不是目标。
 * - 828.1 / 828.1.b / 828.1.c / 828.1.d："[Empowered][>]" 之后的整句是
 *   Dependent Ability，条件为"只要我拥有 Empowered 状态"；727.1.b.1 说明该能力
 *   仍然写在卡上，只是按条件判断是否 Active。
 * - "I have [Deflect]"：809.1.b.3 规定省略 Deflect Value 时按 1；"and
 *   [Shield 3]"：814.1.b.3 规定省略时按 1、本卡写明 3（814.1.c 为 "while I am a
 *   defender, I have +X [M]"）。两者都是授予自身的被动关键词，按 Shield.ts /
 *   Assault.ts 的图层约定用 appliesTo: "self" 表达。
 *
 * 结构说明：
 * - 关键词只声明，不重写展开（契约 3.7 / README 第 5 节）。
 * - Empowered 门控用显式谓词占位（"empowered"），由 condition.predicate 与关键词
 *   系统消费；本程序不手写状态判定，也不把依赖能力改成无条件能力。
 *
 * 执行证据：templates/keyword-static-static-673.test.mjs 与本卡 golden。
 * 复核（2026-10-18，第三轮 M2 覆盖率复核，逐条实测）：
 * - 旧 judgeReason 第 (3) 条的「layers/ 尚未消费 continuous.grant-keyword」已不成立：
 *   指令原语随 RIFT-258 合入（注册表可见），它在 ability 图层建立注册，layers/engine.ts
 *   的 applyAbility 会把它写进 keywords 特征（golden 用真实原语 + 图层引擎断言
 *   Deflect 1 与 Shield 3 真的出现）。
 * - Empower KeywordDef 已合入，但仍不可执行的是：(a) CardProgram 的 KeywordAbility 没有每实例
 *   params.cost，programs/keywords.ts 也不透传它；本卡的 12 Energy 与 per-rune 减费无法进入展开，
 *   默认占位 cost.kind "empower" 会被 translateCost 拒绝；(b) 费用改写静态效果
 *   （continuous.cost-modification, appliesTo "empower-activation-cost"）在
 *   programs/statics.ts 的 staticTarget 里没有映射，bind 时 fail-closed
 *   （实测 Unsupported static appliesTo）；(c) 逐符文减费的 per 仍是描述性字符串，
 *   cost/discounts 无法求值，解释器的 count.filter.controller:self 也会计成 0；
 *   (d) 被授予的 Deflect 展开成 target.tax，而 layerFor 对 target.tax 抛
 *   "Static ability kind target.tax has no layer mapping"，默认 lifecycle 未把该 Power tax
 *   接入 Chain Finalize；Shield 的 defender Might 只在 KeywordGrantLayerEngine 隔离路径重展开。
 *   已实测可用：真实的 Empower/Disempower 动作经 createEngineStaticBinder 授予并撤销
 *   Deflect 1 / Shield 3（defender 时 +3 Might），故这些不再记作缺口。
 * 依赖 Empower 印刷费用参数通道、empower-activation-cost 消费方与 target.tax 的静态绑定。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    value: 12
  },
  {
    // 827.1.c.3 / 206.1：Empower 费用的改写文本，只在确定该 Empower 起动费用时计入
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      appliesTo: "empower-activation-cost",
      per: "rune-you-control",
      minimum: 0,
      amount: {
        kind: "arithmetic",
        operator: "neg",
        operands: [{
          kind: "count",
          subject: "runes",
          filter: { type: "rune", controller: "self", zone: "rune-zone" }
        }]
      }
    }
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keywords: [
        { id: "deflect", value: 1 },
        { id: "shield", value: 3 }
      ]
    },
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-1318a3352539e807f9e1630c856d2c196aa0c08582d7d3c992b230a01f6fe243",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺（2026-10-18 实测）：(1) 827.1.c.1/827.1.c.3/827.1.c.5 的印刷 12 Energy 没有通道到达展开：" +
    "KeywordAbility 只有 keyword/value，程序展开仍是占位 cost { kind: \"empower\" }，translateCost 以 " +
    "\"Unsupported cost kind empower\" 拒绝；continuous.cost-modification 的 empower-activation-cost 在 " +
    "programs/statics.ts 的 staticTarget 抛 Unsupported static appliesTo，bindStatic 直接失败，该费用改写没有绑定与消费方。" +
    "(2) 442.1.a 的 Empowered 门控（828.1.c 的 continuous.grant-keyword + self.empowered 比较）本身已可求值；但逐符文折扣的 per 仍是不可求值的字符串 rune-you-control，且解释器把 count.filter.controller:self 计成 0；两条路径都拿不到" +
    "\"每 1 枚符文少 1 Energy\" 的数值，不把缺失费用变成免费启动。(3) 授予关键词的落地不完整：实测 createEngineStaticBinder 在本卡声明下" +
    "能随真实 Empower/Disempower 授予并撤销 Deflect 1 / Shield 3（CombatRole 为 defender 时 +3 Might），但被授予的 Deflect 展开成 " +
    "target.tax，而 programs/statics.ts 的 layerFor 对 target.tax 抛 \"Static ability kind target.tax has no layer mapping\"，" +
    "默认 CardProgram lifecycle 也不会把该 Power 税接入 Chain Finalize；Shield 的 defender Might 同样只在独立 KeywordGrantLayerEngine 重展开。" +
    "子集证据不证明整卡可执行。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune you control. (Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while I'm a defender.)"
} satisfies CardProgram;
