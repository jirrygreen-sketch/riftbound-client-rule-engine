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
 * 复核（2026-10-17，第二轮 M2 覆盖率复核）：
 * - 旧 judgeReason 的「continuous.might 无原语（RIFT-91）」与「无 replacement 消费方
 *   （RIFT-120）」已不成立：continuous.might 已注册并经 runAbilityBody 真实执行
 *   （arithmetic 图层），ProgramStaticBinder.bindReplacement 也已合入。
 * - 仍不可执行的是：Empower/Empowered KeywordDef；Empowered 状态谓词（进行中任务
 *   RIFT-359）；替代面的 stun 事件在 replacement/pattern.ts 的封闭 ACTION_KINDS 里
 *   没有映射、chosenBy 不是可判别键、return-to-hand 与 -Might 修改没有 pattern 形态、
 *   continuous.might 不在 replacement planner 支持的替换指令集里（实测
 *   BlockedReplacementError）。
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
    "能力门槛不可求值（进行中任务 RIFT-359 条件谓词）；(3) “give me +3 :rb_might:”的 continuous.might" +
    "指令已合入（runAbilityBody 实测执行并注册 arithmetic 图层），但替代消费方仍未合入这一条替换指令：" +
    "replacement/planner.ts 不支持 op continuous.might（实测 BlockedReplacementError）；" +
    "(4) 369.1 的替代事件面不可执行：event \"stun\" 不在 replacement/pattern.ts 的封闭 ACTION_KINDS 映射里" +
    "（未知事件永不匹配），chosenBy 也不是可判别键；return-to-hand 与 -Might 修改在冻结的 EventPattern 里" +
    "没有判别值，“chooses me” 需要 targeting 来源（355.6/355.7）。不近似实现（不把三种结果压成一个，" +
    "也不把替代写成触发）。",
  abilities,
  sourceText:
    "[Empower] :rb_rune_body::rb_rune_body: (:rb_rune_body::rb_rune_body:: Empower me. " +
    "Use only if not Empowered.)\n" +
    "[Empowered][>] If a spell or ability that chooses me would stun me, give me -:rb_might:, " +
    "or return me to hand, give me +3 :rb_might: instead."
} satisfies CardProgram;
