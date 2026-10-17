import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shadow Assassin (ven-013-166) — Unit, Fury, tag Ionia.
 * energy 5, power: none printed, Might 5.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-013-166，逐字）：
 *   I enter ready if you have a card with my name in your trash.
 *
 * 规则依据（Core Rules v1.5）：
 * - 359.2.c：单位默认横置进入 Board；369.3（官方例子 Master Yi, Honed 的 “I enter ready.”）
 *   明确这种“描述单位如何进场”的文本是**入场替代效果**，把「横置进场」替换为「就绪进场」。
 *   effect.ready 的文件头记录本原语不参与入场替代，也不能拿它事后重置来模拟。
 * - 053.1/053.4："my name" 是 132.1 的卡名；132.3/132.4 规定同名比较按完整牌名
 *   （[短名], [副标题]）进行。
 * - 108.2.a / 414.x 的区域语义："your trash" 是能力控制者的 Trash（zone "trash"）。
 * - 383.2.a：本句没有 When/At/Nth Time 的触发条件，是一句条件性的被动/替代文本，
 *   因此按其“进场方式”性质写成 replacement 能力（条件写在 replacement.condition）。
 *
 * status = judge-required（依赖均不近似实现）：
 * 1. 卡牌程序侧的替换注册未接线：programs/statics.ts 的 createEngineStaticBinder()
 *    .bindReplacement 已合入并能执行替代体（绑定后横置进场真的就绪进场，golden 有执行
 *    证据；机制执行证据，但没有任何生产模块把 CardProgram 的 replacement
 *    能力经该绑定装进事件管线，因此按卡牌打出流程的替换不会发生。
 * 2. 同名比较没有可执行谓词：ObjectFilter 的 characteristics 只能做顶层字段等值，
 *    Expr 也没有「读来源的卡名并与候选比较」的形态；filter 里按 describe 记录的占位键
 *    （sameNameAs: "self"）没有任何消费方。把同名近似成 tag 或类型都会改变语义（132.3/132.4）。
 * 3. Trash 计数的占位符未归一化：replacement 条件经生产求值路径（replacement/bind.ts 的
 *    testCondition）对 owner: "self" 占位符求值恒为 false（catch→false，三场景实验证据：
 *    同名 trash / 异名 trash / 空 trash 都不触发），canonicalCardId 等值过滤也被参考内核与
 *    生产 ctx.query 的未知键跳过（反例查询恒真，见实验 /tmp/RIFT-438-resweep2-ven-13/
 *    experiments/canon-negative.mjs）。在占位符归一化与同名谓词落地前断言该条件等于把
 *    「不触发」写成预期。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: {
      // 359.2.c / 369.3：替换「单位横置进入 Board」这一事件。
      event: "object-enters-board",
      filter: { source: "self", exhausted: true }
    },
    // 369.3：条件是进场方式的适用条件（"if you have a card with my name in your trash"）。
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "cards",
        filter: {
          zone: "trash",
          owner: "self",
          // 描述性键：132.1/132.3/132.4 的同名比较需要卡名谓词，现有 ObjectFilter 的
          // characteristics 只做顶层字段等值，没有任何消费方读取该键（见 judgeReason）。
          sameNameAs: "self"
        }
      },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    },
    with: [
      {
        id: "shadow-assassin.enter-ready",
        // 369.3 / effect.ready 文件头：就绪进场由入场替代完成，本指令只在替代体里表达该结果。
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-101dc13865ec4192cab5368a9a51d1582968c98f57b52ab293cd35e4c5313b0c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1) 卡牌程序侧的替换注册未接线——programs/statics.ts 的 createEngineStaticBinder()" +
    ".bindReplacement 已合入，绑定后替代体真实执行（横置进场 → 就绪进场，golden 有机制级执行证据；" +
    "但没有生产模块把 CardProgram 的 replacement 能力装进事件管线，" +
    "因此打出流程中 359.2.c/369.3 的替换不会发生；不把 effect.ready 当作事后重置来近似。" +
    "(2)「a card with my name」缺卡名比较谓词——132.1/132.3/132.4 的同名是完整牌名比较，" +
    "ObjectFilter 的 characteristics 只做顶层字段等值，Expr 也没有读取来源卡名并与候选比较的形态，" +
    "filter 里的 sameNameAs 是无消费方的描述性占位；(3) 替换条件的占位符未归一化——replacement/bind.ts 的 " +
    "testCondition 对 owner: 'self' 求值恒为 false（catch→false，同名/异名/空 trash 三场景实验一致），" +
    "canonicalCardId 等值过滤在参考内核与生产 ctx.query 也被未知键跳过（反例恒真），归一化与同名谓词落地前" +
    "不能断言条件成立。with 体的 effect.ready 本体已合入，golden 覆盖替代体执行与 bindReplacement 机制对照。" +
    "依赖：卡牌 replacement 能力的生产注册接线、卡名比较谓词与 Trash 过滤键归一化。不近似实现。",
  abilities,
  sourceText: "I enter ready if you have a card with my name in your trash."
} satisfies CardProgram;
