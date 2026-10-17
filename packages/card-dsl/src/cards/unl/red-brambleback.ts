import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Red Brambleback（unl-029-219）— Unit, 4 energy, 1 power, Might 4, Fury,
 * tag Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-029-219，逐字）：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost
 *   to have me enter ready.)
 *   Your conquer effects for conquering here trigger an additional time.
 *   When I conquer, [Buff] a friendly unit. (Give it a +1 :rb_might: buff if it
 *   doesn't have one.)
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805.1 / 805.1.b）：单位上的可选附加费用关键词，费用固定 1 energy + 1 power；
 *   805.2.b/805.6 付费后以就绪状态进场；805.4 多个实例冗余。只声明 keyword（契约 3.7）。
 * - “Your conquer effects for conquering here trigger an additional time.”：
 *   383.4.c.3 定义 Conquer Effects；让某个命名触发“额外触发一次”是**触发收集阶段**的改写
 *   （383.4.g 一族）。CR v1.5 用本卡本身的例子说明界限（383.4.g.2）：被“激活”（如 Reckoner's Arena
 *   对 Hold 的处理）而进入链的 conquer effects 没有真正发生 Conquer，因此不会因本卡而额外触发。
 *   该改写不是结算期的 repeat（820 的 Repeat 是可选附加费用关键词，语义完全不同）。
 * - “When I conquer, [Buff] a friendly unit.”：383.4.c / 383.4.c.1 / 383.4.c.2.a 的 Conquer Effect，
 *   时点用闭表的 conquer；355.9 / 355.10 “a friendly unit” 是单个选目标（355.7 的 pick 不是目标）。
 *   [Buff] 是 702.2.a 的 Buff 动作——玩家选择一个单位并在其上放置一个 buff 标记；
 *   702.3/702.3.a 规定一个单位同时只能有一个 Buff（已有 Buff 的单位仍然合法可选，只是不再放置），
 *   由已合入的 effect.buff（mode buff）执行，+1 [M] 由 703 的图层规则推导。
 *
 * status = judge-required（2026-10-17 复核，缺口不近似实现）。
 * 已合入并可真实执行的部分：conquer 时点由 turn/flow.ts 的 Score 波次真实发出、effect.buff 原语与卡牌程序绑定（RIFT-257），
 * 事件过滤器用闭表的 conquered 拼写可通过 assertTriggerSpec 注册。
 * 仍缺三处（见 judgeReason）：conquer 载荷缺单位归属、触发收集阶段没有倍率接口、
 * [Accelerate] 的费用与入场替代没有消费方。
 * 数据问题：同一身份的异画 unl-029a-219 在本地目录丢失 Ionia 标签（见 docs/plans/survey/data-issues-recheck.md），
 * 本任务按 unl-029-219 的原文书写，不改卡牌数据。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    // 383.4.g / 383.4.g.2：让“在这里征服触发的己方 conquer effects 额外触发一次”。
    // 触发收集阶段的倍率改写；没有消费者，只保留待接线声明（同 Karthus, Eternal 先例）。
    kind: "static",
    effect: {
      kind: "continuous.trigger-multiplicity",
      mode: "additional",
      amount: { kind: "constant", value: 1 },
      appliesTo: {
        trigger: "conquer",
        controller: "controller",
        zone: "board",
        // “here”：来源战场锚点（053.3）；真实 conquer 事件才生效（383.4.g.2）。
        here: true,
        // 只对“真正 conquering here”的 Conquer Effects 生效，被激活的触发不算。
        realConquerOnly: true
      }
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      // 383.4.c.2：“When I conquer” 由本卡自身的征服触发。
      filter: { event: "conquered", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "red-brambleback.buff-friendly-unit",
        op: "effect.buff",
        args: {
          mode: { kind: "constant", value: "buff" },
          target: { kind: "constant", value: "red-brambleback.friendly-unit" }
        },
        targets: [
          {
            id: "red-brambleback.friendly-unit",
            // 355.9 / 355.10：“a friendly unit” 是由能力控制者选择的单个单位目标。
            // 702.3/427.1.c：已有 Buff 的单位仍是合法目标，只是不会放置第二个 Buff。
            filter: { type: "unit", controller: "controller", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-cc540d8a2bbd62d237f265dc99b08da25c4499af36778a1dc01cf4165c0b9553",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "conquer 时点已由 turn/flow.ts 的 Score 波次真实发出，effect.buff 与卡牌程序绑定（RIFT-257）也已合入；" +
    "仍有三处当前缺口，均不近似实现：" +
    "(1) conquer 订阅缺单位归属：turn/flow.ts 发出的 conquer 只带 { battlefieldId }（timing-points.ts 的 conquer 条目没有声明 payloadFields），" +
    "而 programs/triggers.ts 把 { source: \"self\" } 翻译成 { event: \"conquered\", object: { objectId: <本卡> } }；" +
    "实测该过滤器对只带 player + battlefieldId 的 conquer 事件不匹配（事件里没有承载征服单位的 object），" +
    "加上 object 才匹配。383.4.c.2 的“在这里征服的这张单位”没有归属字段可绑（同 ogn/sigil-of-the-storm 的归属缺口）。" +
    "(2)「Your conquer effects for conquering here trigger an additional time.」" +
    "（383.4.c.3 的 Conquer Effects 触发收集改写；383.4.g.2 用本卡自己的例子区分“真正 Conquer”与“被激活的触发”）" +
    "没有引擎模型：Ability 的六种形状没有触发倍率，ContinuousEffect.kind 没有倍率消费者，触发收集阶段（events/）也没有倍率接口；" +
    "static 绑定实测先被 staticTarget 拒绝（\"Unsupported static appliesTo {\"trigger\":\"conquer\",…}\"），" +
    "即使去掉 appliesTo 也会因 continuous.trigger-multiplicity 无图层映射而失败——与已合入 ogn/karthus-eternal、" +
    "rad/detonation-amplifier 记录同一缺口，按 Karthus 先例保留 static 声明而不用结算期 repeat 近似（820 的 Repeat 是可选附加费用关键词，语义不同）。" +
    "(3) [Accelerate] 的展开文件虽已合入，但没有消费者：programs/play.ts 的 translateCost 对 additional-cost 类字段判 judge-required" +
    "（实测抛 \"Unsupported play cost field optional\"），展开出的 static accelerate.cost 在 programs/statics.ts 也抛 " +
    "\"Static ability kind accelerate.cost has no layer mapping\"，所以无法把卡牌 keyword 接进 Finalize 费用计划与 replacement.enter 管线" +
    "（805.2.b/805.6；展开出的 replacement 形状本身可绑定）。" +
    "已可真实执行的部分：conquer 触发结构（conquered 拼写通过 assertTriggerSpec 注册、翻译后的 object 过滤正确）" +
    "+ effect.buff 本体（golden 用解释器 + 参考内核执行 702.3.a 的重复 Buff 边界）。" +
    "依赖：conquer 载荷的单位归属、触发倍率接口（events/）、Accelerate 费用与入场替代接线。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "Your conquer effects for conquering here trigger an additional time.\n" +
    "When I conquer, [Buff] a friendly unit. (Give it a +1 :rb_might: buff if it doesn't have one.)"
} satisfies CardProgram;

export default program;
