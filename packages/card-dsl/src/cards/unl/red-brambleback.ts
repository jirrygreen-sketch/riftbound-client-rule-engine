import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Red Brambleback (unl-029-219) — Unit, 4 energy, 1 power, Might 4, Fury,
 * tag Ionia.
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
 *   时点用封闭表的 conquer；355.9 / 355.10 “a friendly unit” 是单个选目标（355.7 的 pick 不是目标）。
 *   [Buff] 是 702.2.a 的 Buff 动作——玩家选择一个单位并在其上放置一个 buff 标记；
 *   702.3/702.3.a 规定一个单位同时只能有一个 Buff（已有 Buff 的单位仍然合法可选，只是不再放置），
 *   由已合入的 effect.buff（mode buff）执行，+1 [M] 由 703 的图层规则推导。
 *
 * status = judge-required（缺口不近似实现）：
 * - “trigger an additional time” 没有引擎模型：Ability 的六种形状没有触发倍率，
 *   ContinuousEffect.kind 没有倍率消费者，触发收集阶段（events/）也没有倍率接口
 *   （与已合入 ogn/karthus-eternal、rad/detonation-amplifier 记录同一缺口，按 Karthus 先例写 static 声明）。
 * - [Accelerate] 的展开文件已合入，但没有消费者把卡牌 keyword 能力接进 Finalize 费用计划与
 *   replacement.enter 管线（RIFT-89），chain/engine.ts 只读调用方传入的费用计划。
 * 已合入并可真实执行的部分：conquer 触发结构 + effect.buff 本体（golden 用解释器 + 参考内核执行）。
 * 数据问题：同一身份的异画 unl-029a-219 在本地目录丢失 Ionia 标签（见 docs/plans/survey/data-issues-recheck.md），
 * 本任务按 unl-029-219 的原文书写，不改卡牌数据。
 * 依赖：kw-deploy 之外的触发倍率接口（events/，RIFT-82 cohort）、RIFT-89（Accelerate 费用与入场替代）、RIFT-120（触发注册）。
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
      filter: { event: "conquer", filter: { source: "self" } }
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
    "「Your conquer effects for conquering here trigger an additional time.」（383.4.c.3 的 Conquer Effects 触发收集改写；" +
    "383.4.g.2 用本卡自己的例子区分“真正 Conquer”与“被激活的触发”）没有引擎模型：Ability 的六种形状没有触发倍率，" +
    "ContinuousEffect.kind 没有倍率消费者，触发收集阶段（events/）也没有倍率接口——与已合入 ogn/karthus-eternal、" +
    "rad/detonation-amplifier 记录同一缺口，按 Karthus 先例保留 static 声明而不用结算期 repeat 近似（820 的 Repeat 是" +
    "可选附加费用关键词，语义不同）。此外 [Accelerate] 的展开文件虽已合入，但没有消费者把卡牌 keyword 能力接进 Finalize " +
    "费用计划与 replacement.enter 管线（RIFT-89；chain/engine.ts 只读调用方传入的费用计划），conquer 触发也没有 " +
    "CardProgram → TriggerRegistration 的注册路径（RIFT-120）。" +
    "已可真实执行的部分：conquer 触发结构 + effect.buff 本体（golden 用解释器 + 参考内核执行 702.3.a 的重复 Buff 边界）。" +
    "依赖：触发倍率接口（events/）、RIFT-89、RIFT-120。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "Your conquer effects for conquering here trigger an additional time.\n" +
    "When I conquer, [Buff] a friendly unit. (Give it a +1 :rb_might: buff if it doesn't have one.)"
} satisfies CardProgram;

export default program;
