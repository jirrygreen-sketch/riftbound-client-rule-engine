import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Renekton, Brute (ven-092-166) — Unit, 5 Energy, Might 4, Body,
 * tags Shurima/Renekton/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-092-166，逐字）：
 *   :rb_energy_1:: Give me +1 :rb_might: this turn.
 *   When my Might becomes 10 or more, empower me. (I become Empowered if I'm not
 *   already.)
 *   [Empowered][>] I have [Deflect] and [Ganking]. (Opponents must pay
 *   :rb_rune_rainbow: to choose me with a spell or ability. I can move from
 *   battlefield to battlefield.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 404.1.a / 415.5：“:” 前的 :rb_energy_1: 是启动能力的 Base Cost（1 Energy）；契约 3.1 用
 *   activated + CostSpec 记录（同 ven/heart-of-the-tempest 一类写法）。程序侧 activated cost
 *   已由 programs/activate.ts 绑定到 ChainDraft 的费用计划，415.4 的可支付性由费用管线校验。
 * - “give me +1 :rb_might: this turn”：带回合期限的临时 Might 修正（479.4.e.1 的算术层增加；
 *   到期在回合结束清理，315.4 / 317.2.c）。已合入的 continuous.might 指令（RIFT-258）通过
 *   appliesTo "self" 把算术层 +1 注册到能力来源上，不写成 Buff 计数（702/703）。
 * - “When my Might becomes 10 or more”：Might 变化事件的观察时点 "might-changed"
 *   （events/timing-points.ts，ruleRefs 143.2/708/709；载荷带 previousMight/currentMight）。
 *   709 定义 “become” 的转换语义（从低于阈值变为不低于），因此完整条件是
 *   previousMight < 10 ≤ currentMight；EventPattern 的 details 只接受标量、数值匹配器
 *   （NumericMatcher）只作用于 event.amount，且 might-changed 的 producer 未接入管线，
 *   转换的两个边都写不出来（见 judgeReason 第 1 条）。
 * - 442.1 / 827.1.b.1：“empower me” 把能力来源自身变为 Empowered；442.1.c 说明已 Empowered
 *   时什么也不发生；已合入的 effect.empower 支持 { kind: "source" } 选择。
 * - 828.1.a / 828.1.b.1：[Empowered][>] 是 Dependent Keyword，整段是“只要我拥有 Empowered
 *   状态即生效”的依赖能力。
 * - 809 / 810：[Deflect] 与 [Ganking] 是只声明身份的关键词（展开归 effects/keywords/）。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    // 145.2：单位启动能力默认在其控制者的 Main 阶段以普通时机执行。
    timing: "action",
    cost: {
      kind: "activated",
      // :rb_energy_1: = 1 Energy（404.1.a、415.5）。
      energy: { kind: "constant", value: 1 }
    },
    body: [
      {
        id: "renekton.give-plus-1-might",
        // 「give me +1 :rb_might: this turn」：带回合期限的临时 Might 修正；“me” 是能力宿主
        //（355.10.d：按特征自我指代不是目标），由已合入 continuous.might 的 appliesTo "self" 表达。
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "this-turn" },
          appliesTo: { kind: "constant", value: "self" }
        }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "might-changed",
      filter: {
        event: "might-changed",
        // 事件对象是本卡（143.2 的单位 Might 变化）；filter 用契约 3.6 的符号选择器
        // { source: "self" } 指向能力来源，沿用仓库卡牌程序的通用写法。
        filter: { source: "self" }
      },
      // “becomes 10 or more” 的当前值一半可求值（143.2.a 的有效 Might）；
      // 转换语义的另一半（previousMight < 10）需要载荷数值匹配器（见 judgeReason 第 2 条）。
      condition: {
        kind: "compare",
        left: { kind: "object-property", object: "self", property: "might" },
        operator: "gte",
        right: { kind: "constant", value: 10 }
      }
    },
    optional: false,
    body: [
      {
        id: "renekton.empower-self",
        // “empower me”：442.1 的 Empower 动作，来源自身为对象且不是目标
        //（827.1.b.1 同型）。effect.empower 已合入。
        op: "effect.empower",
        args: {
          objects: { kind: "constant", value: { kind: "source" } }
        }
      }
    ]
  },
  {
    // [Empowered][>] I have [Deflect] and [Ganking]：828.1.b.1 的依赖能力只在
    // 宿主 Empowered 时授予两个关键词（809/810）。门槛是 442.1.a 的二元状态，
    // condition 里的 empoweredCount 只是描述性记录（见 judgeReason 第 3 条）。
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keywords: [{ id: "Deflect" }, { id: "Ganking" }],
      appliesTo: "self"
    },
    condition: {
      kind: "compare",
      left: {
        kind: "object-property",
        object: "self",
        property: "empowered"
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId: "card.hash-84a15f0f4b24ba842c5300ae2aa02facd4e08b04b533d248b5acc6aa5e2f1983",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺三段：(1) 「When my Might becomes 10 or more」需要 previousMight < 10 <= currentMight；might-changed producer 已存在，但未接入图层更新事件流，EventPattern.details 仍只支持标量等值，无法表达前后阈值比较。当前条件只描述 current Might >= 10，不能将 10→11 当成新跨越。(2) 828.1.b.1 的门控已改用 self.empowered >= 1；参考内核可读取，ObjectSnapshot 尚未声明该状态，442.1 的重复 Empower 约束仍须生产动作层保证。(3) continuous.grant-keyword、Deflect target.tax 收集器与 Ganking movement 规则查询均已合入，但 Chain Finalize 尚未使用 createTargetTaxAdapter，仍把旧税 amount 转成 Energy；授予的 Deflect/Ganking 也未与生产目标税/标准移动完整联通。continuous.might 与 effect.empower 已真实执行，保留 judge-required，不近似实现。",
  abilities,
  sourceText:
    ":rb_energy_1:: Give me +1 :rb_might: this turn.\n" +
    "When my Might becomes 10 or more, empower me. (I become Empowered if I'm not already.)\n" +
    "[Empowered][>] I have [Deflect] and [Ganking]. (Opponents must pay :rb_rune_rainbow: to choose me " +
    "with a spell or ability. I can move from battlefield to battlefield.)"
} satisfies CardProgram;
