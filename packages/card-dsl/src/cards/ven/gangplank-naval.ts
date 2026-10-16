import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Gangplank, Naval (ven-086-166) — Unit, 6 Energy, Might 6, Body,
 * tags Bilgewater/Gangplank/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-086-166，逐字）：
 *   [Empower] :rb_rune_body::rb_rune_body: (:rb_rune_body::rb_rune_body::
 *   Empower me. Use only if not Empowered.)
 *   [Empowered][>] If a spell or ability that chooses me would stun me, give me
 *   -:rb_might:, or return me to hand, give me +3 :rb_might: instead.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c.1：[Empower] 是 Activated Ability 关键词，本卡印刷费用为
 *   [2 Body Power]；KeywordAbility 没有费用字段（契约 3.8.3 的 params 只加在
 *   KeywordDef.expand 的输入上），因此只声明关键词身份，同 ven-084-166 的写法。
 * - 828.1.a / 828.1.b.1：[Empowered][>] 是 Dependent Keyword，整段是“只要我拥有
 *   Empowered 状态即生效”的依赖能力。
 * - 369 / 369.1：Effect 里的 “would … instead” 是 Replacement Effect；本例同时出现
 *   三种被替代的结果（Stun 424、-Might 修改 479.4.e.2、Return to Hand）——三者都是
 *   “一个选择我为目标的法术或能力”所产生的结果，被同一个替代改写为 +3 Might（479.4.e.1）。
 * - 355.6 / 355.7：“chooses me” 指该法术/能力把我选为目标；targeting 的成立由 355.7 的
 *   Targeting 定义决定（“chooses”）。
 * - 替代效果在动作执行前拦截（契约 3.5 的 GameAction 层）；卡程序只能声明被替代的事件形状
 *   与替换后的指令（见 judgeReason 的缺口）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，缺口见 judgeReason，
 * 不近似实现（不把三个被替代结果压成一个，也不把替代写成触发）。
 */
const abilities: Ability[] = [
  {
    // 印刷费 2 Body Power 见 judgeReason 第 1 条；不伪造启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>] 的替代能力："a spell or ability that chooses me" 的三种结果
    // 都被替换为 “give me +3 :rb_might:”（479.4.e.1 的增加）。
    // replaces 用事件形状记录三种结果；其中 return-to-hand 与 -Might 修改在冻结的
    // EventPattern 里没有等价的判别值（见 judgeReason 第 4 条），stun 用 424 的 stun 动作。
    kind: "replacement",
    replaces: {
      event: "stun",
      filter: {
        // “a spell or ability that chooses me”：来源是一次把我选为目标的法术/能力
        //（355.6/355.7）。静态 IR 只能写描述性锚点（见 judgeReason），
        // 对象是替代事件的受作用者（我自己）。
        object: "self",
        chosenBy: "spell-or-ability"
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
    with: [
      {
        id: "gangplank.give-plus-3-might",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 3 },
          duration: { kind: "constant", value: "this-turn" },
          object: { kind: "constant", value: { kind: "source" } }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-b5e0e99c33e99ceb92c979c2c0f321e1350559022b999c6941a10dfd1d0d8508",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，827.1.c.1 的" +
    "“[2 Body Power]：Empower me，仅当未 Empowered 时启动”无法展开（依赖新的 Empower/Empowered 关键词任务）；" +
    "(2) 没有 Empowered 状态谓词——442.1.a 的二元状态不在 ObjectSnapshot / Condition 里，828.1.b.1 的依赖" +
    "能力门槛不可求值（依赖 RIFT-87）；(3) “give me +3 :rb_might:”是算术层 Might 增加（479.4.e.1），卡牌侧" +
    "没有 continuous.might 的注册/求值原语（RIFT-91 只合入 layers 引擎，卡牌入口缺失）；" +
    "(4) 替代面不可执行：“If a spell or ability that chooses me would stun me, give me -:rb_might:, or return me " +
    "to hand” 的三种被替代结果里，return-to-hand 与 -Might 修改在冻结的 EventPattern 里没有判别值，" +
    "“chooses me” 需要 targeting 来源（355.6/355.7）与 369 的替代注册接线，而合并代码没有把 CardProgram 的 " +
    "replacement 能力注册成 ReplacementRegistration 的消费方（events/pipeline.ts 需要调用方提供 matches/apply；" +
    "RIFT-120 之后的 card-program 适配器未合入）。不近似实现（不把三种结果压成一个，也不把替代写成触发）。",
  abilities,
  sourceText:
    "[Empower] :rb_rune_body::rb_rune_body: (:rb_rune_body::rb_rune_body:: Empower me. " +
    "Use only if not Empowered.)\n" +
    "[Empowered][>] If a spell or ability that chooses me would stun me, give me -:rb_might:, " +
    "or return me to hand, give me +3 :rb_might: instead."
} satisfies CardProgram;
