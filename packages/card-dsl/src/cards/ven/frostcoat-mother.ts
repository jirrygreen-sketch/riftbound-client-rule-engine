import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Frostcoat Mother (ven-032-166) — Unit, Calm, 3 Energy, Might 3, tag Dog/Freljord.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-032-166，逐字）：
 *   [Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune you
 *   control. (Pay the cost: Empower me. Use only if not Empowered.)
 *   [Empowered][>] I have +3 :rb_might:.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c / 827.1.c.1：[Empower] 是启动能力关键词，本卡印刷费用 12 Energy；
 *   按契约 3.7 卡牌只声明 { kind: "keyword", keyword: "empower", value: 12 }，展开
 *   （cost.activated + effect.empower + “仅未 Empowered 时启动”）归 keywords/。
 * - 827.1.c.3 / 206.1：Empower 能力也可以带有修改该 Empower 费用的文本；任何需要确定
 *   该卡 Empower 费用的场合都要计入。因此 “This ability costs 1 less for each rune you
 *   control” 是这条 Empower 起动费用的一部分，不是独立效果——程序用一条指向
 *   "empower-activation-cost" 的 continuous.cost-modification 记录（per: "rune-you-control"），
 *   由费用/关键词侧消费；不改 IR 类型（同 ven-050-166 Grumpy Rockbear 的写法）。
 * - 190.6.d：“you control” 的隐含 “you” 是能力控制者；133.5.a.1 / 431.1：已 channel 的
 *   符文留在控制者的符文区，所以 “each rune you control” = 控制者符文区中的符文数量。
 * - 828.1.b / 828.1.b.1：”[Empowered][>] I have +3 :rb_might:” 是依赖能力，只在宿主拥有
 *   Empowered 状态时 Active；+3 Might 属 layers 的 arithmetic 层（143.2/143.2.a、479）。
 *
 * status = judge-required（复核 2026-10-18，缺口逐条实测）：费用参数、逐符文折扣与
 * 生产 Empowered 状态仍缺，当前缺口见 judgeReason；
 * 执行证据见 templates/keyword-static-static-673.test.mjs 与本卡 golden。
 */
const abilities: Ability[] = [
  {
    // 827.1.c.1：印刷费 12 Energy；不伪造启动能力（见 judgeReason）。
    kind: "keyword",
    keyword: "empower",
    value: 12
  },
  {
    // 827.1.c.3 / 206.1：该文本只改这条 Empower 起动费用（每控制 1 枚符文少 1 Energy）。
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
    // 828.1.b.1 的依赖能力：宿主 Empowered 时获得 +3 Might（arithmetic 层）。
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
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-af86d71346754f5a19f63ebf193cb978f3d3dffe541f342d86bd89ab951eefb8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺（2026-10-18 实测）：(1) 827.1.c.1 的印刷 12 Energy 没有通道到达展开：" +
    "KeywordAbility 只有 keyword/value，expandProgram 传给 Empower.expand 的仍是默认占位，实测展开结果是 " +
    "cost { kind: \"empower\" } 并被 translateCost 以 \"Unsupported cost kind empower\" 拒绝。" +
    "(2) 827.1.c.3 的逐符文减费没有消费方：programs/statics.ts 的 staticTarget 对 appliesTo " +
    "\"empower-activation-cost\" 抛 Unsupported static appliesTo，实测 bindStatic 直接失败；把作用域换成已识别的 " +
    "activated-ability-cost 后 cost/discounts 的 scopeMatches 仍不匹配该声明，collectCostModifications 返回空 discounts。" +
    "(3) 该声明的 per 仍是不可求值的字符串 rune-you-control（实测 evaluateCostValue 原样返回，costInteger 随后抛 " +
    "Cost modification requires a safe integer amount），且解释器把 count.filter.controller:self 计成 0，同一条 IC 内两种路径都得不到" +
    "\"每 1 枚符文少 1 Energy\" 的数值。(4) 442.1.a 的生产状态：参考内核与 createEngineStaticBinder 能按 442.1/443.1 真实增减 " +
    "Empowered 并让 +3 Might 生效（golden 覆盖 3→6→3），但 apps/game-server 的 host 把 empower 记在 buffs 上、" +
    "ObjectSnapshot 也未声明该特征，生产门控仍不可求值。442.1.a/828.1.c 的门控形状本身正确，不近似实现费用或状态。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune you control. (Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +3 :rb_might:."
} satisfies CardProgram;
