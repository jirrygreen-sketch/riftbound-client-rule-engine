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
 * status 判定（cards/README.md 第 2 节）：judge-required（缺口见 judgeReason）。
 * golden 用真实解释器 + 参考内核执行已合入的 “empower me”（effect.empower）与
 * “+1 Might this turn”（continuous.might + appliesTo self），其余依赖写 test.todo。
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
        property: "empoweredCount"
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
    "三处缺口：(1) “When my Might becomes 10 or more” 的转换语义（709：previousMight < 10 ≤ currentMight）无法完整表达——" +
    "might-changed 的载荷带两个数值，但 EventPattern 的 details 只接受标量、数值匹配器只作用于 event.amount，且 might-changed " +
    "的 producer（events/producers/might-change.ts）没有管线接线；程序以 { source: \"self\" } 锚点 + 当前 Might ≥ 10 的 condition 记录" +
    "（依赖 RIFT-87/120 的载荷匹配扩展），从 10 以下降回 10 以上会多触发，故不标 executable；(2) 没有 Empowered 状态谓词" +
    "（442.1.a 的二元状态不在 ObjectSnapshot / Condition 里，快照无 empowered 字段），[Empowered][>] 依赖能力（828.1.b.1）的门槛" +
    "不可求值，empoweredCount 只是描述性记录；(3) Deflect/Ganking 的关键词语义没有运行时消费方（Deflect 的 target.tax 属 RIFT-360；" +
    "Ganking 的 continuous.movement 移动系统不读该关键词；continuous.grant-keyword 指令与 static 绑定已合入，缺的是下游消费）。" +
    "已支持部分：activated cost 已由 programs/activate.ts 绑定；effect.empower（“empower me”，442.1）与 continuous.might（“+1 Might this turn”，479.4.e.1/317.2.c，" +
    "appliesTo self）由 golden 用真实解释器 + 参考内核执行。依赖：RIFT-87、RIFT-120、" +
    "RIFT-360（Deflect 目标税）。不近似实现。",
  abilities,
  sourceText:
    ":rb_energy_1:: Give me +1 :rb_might: this turn.\n" +
    "When my Might becomes 10 or more, empower me. (I become Empowered if I'm not already.)\n" +
    "[Empowered][>] I have [Deflect] and [Ganking]. (Opponents must pay :rb_rune_rainbow: to choose me " +
    "with a spell or ability. I can move from battlefield to battlefield.)"
} satisfies CardProgram;
