import type { CardProgram } from "../../ir/index.js";

/**
 * Defiant Dance (sfd-196-221) — Spell, 1 energy + 1 Calm power, tags
 * Irelia/Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-196-221，逐字）:
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    Give a unit +2 :rb_might: this turn and another unit -2 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - "[Reaction]"（813）是许可类关键词：813.1.b 授予 Action 的全部许可（含 Showdown），
 *   813.1.c 额外允许在任意玩家回合的 Closed State 期间打出，813.3 强调它只是许可、
 *   不改变指令功能。卡只声明关键词，展开由 effects/keywords/Reaction.ts 负责（契约 3.7），
 *   准入判定属 chain 的 canAct（契约 3.5）。
 * - 两个单位都是目标："a unit" / "another unit" 是玩家做出的具体对象选择（355.7；
 *   355.9.a.1 的 unit 指 Board 对象；355.9.b 要求符合限制），不适用 355.10 的任一例外，
 *   因此各写一个 TargetSpec，而不是 pick。
 * - "another unit" 是与第一个目标"不同"的限制（355.9.b 的目标限制）：用已合入的过滤器锚点
 *   exclude: { target: "defiant-dance.unit" } 排除第一个目标（OBJECT_FILTER_ANCHORS 之一，
 *   由解释器的集合查询解析为运行时引用），第二个单位因此不会与第一个相同。
 * - "+2 Might this turn" 与 "-2 Might this turn" 是带有回合期限的临时 Might 修正：
 *   143.2.a 规定卡牌文本里的 "Might" 指 Effective Might（arithmetic 层算出的值），
 *   "this turn" 是到该回合结束的期限（317.2.c：所有 "this turn" 效果在清理中同时到期）。
 * - 本卡没有印刷下限：
 *   减量后小于 0 的一般处理是 143.2.c（被法术与能力引用时按 0 处理），不是本卡的印刷限制，
 *   因此这里不写 minimum（与 Stupefy/Smoke Screen 这类印刷 "to a minimum of 1" 的卡不同）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。缺口是临时 Might 修正原语：
 * - 契约 3.6 的封闭 GameAction 集合没有 Might 修改动作；effects/instructions/ 下没有任何
 *   原语通过 ResolveContext.addContinuous 注册 Might 修正（effect.buff 自己的文档明确
 *   "临时 Might 变化归 layers 的 continuous.might，绝不属于本原语"，702/703 的 Buff 计数器
 *   不是 Might 变化），RIFT-91 只合入了 layers 的求值侧；卡牌侧没有可用的注册入口。
 * - 两个目标的选择形状与 exclude 限制本身已可校验，但"修正作出"必须有上述注册路径才能落地；
 *   本文件按 layers 契约形状记录加法与减法两条指令，不做近似实现（不写成 Buff 计数、
 *   不省略 "this turn" 的期限、不省略 "another unit" 的排除）。
 * 依赖：continuous.might / effect.might-modify 指令原语与 continuous.duration 到期（RIFT-91），
 * 以及目标/条件管线（RIFT-87/RIFT-90）。
 */
const defiantDance = {
  canonicalCardId: "card.hash-b159649107e1268bfb45d5d2c64def273ae76898db17907192d8e25e1d7526ef",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺临时 Might 修正的可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 下" +
    "没有任何原语通过 ResolveContext.addContinuous 注册该持续效果（effect.buff 文档明确临时 Might 变化归 layers 的 " +
    "continuous.might，702/703 的 Buff 计数器不是 Might 变化；RIFT-91 只合入 layers 求值侧，卡牌侧没有注册入口）；" +
    "「+2 :rb_might: this turn」与「-2 :rb_might: this turn」按 143.2.a 读写 Effective Might（arithmetic 层），" +
    "并需按 317.2.c 在本回合清理中同时到期。本卡没有印刷下限（143.2.c 的“小于 0 按 0 处理”是一般规则而非本卡限制），" +
    "因此不写 minimum 参数。两个目标与「another unit」的 exclude 限制（355.9.b）可校验，但修正落地依赖上述注册路径。" +
    "依赖：continuous.might / effect.might-modify 原语与 continuous.duration 到期（RIFT-91）、目标与条件管线（RIFT-87/RIFT-90）。" +
    "不近似实现：不写成 Buff 计数，不省略 this turn 期限，不省略 another unit 的排除。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // "Give a unit +2 Might this turn"：第一个目标单位（355.7/355.9.b）。
          id: "defiant-dance.buff-unit",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "defiant-dance.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "and another unit -2 Might this turn"：第二个目标，用 exclude 锚点排除第一个目标
          // （355.9.b 的 "another" 限制）。
          id: "defiant-dance.debuff-another-unit",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -2 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "defiant-dance.another-unit",
              filter: {
                type: "unit",
                zone: "board",
                exclude: { target: "defiant-dance.unit" }
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit +2 :rb_might: this turn and another unit -2 :rb_might: this turn."
} satisfies CardProgram;

export default defiantDance;
