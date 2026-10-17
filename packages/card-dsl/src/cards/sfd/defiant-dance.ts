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
 * status 判定（cards/README.md 第 2 节）：executable。
 * - 两条修正均用已合入的 continuous.might 原语（RIFT-258）：按 478/478.1.a 注册 arithmetic
 *   层效果，经 ResolveContext.addContinuous + duration "this-turn" 在清理时到期
 *   （317.1.a/317.2.c/468.7.c）。golden 用生产链适配器（resolveChainBody）执行卡牌正文，
 *   断言注册形状、加/减结果、回合末到期与目标失效边界。
 * - 本卡没有印刷下限（143.2.c 的"小于 0 按 0 处理"是一般规则而非本卡限制），因此不写
 *   minimum 参数；终值钳制由图层引擎的通用算术完成。
 * - 两个目标与 "another unit" 的 exclude 限制（355.9.b）由解释器集合查询真实消费。
 */
const defiantDance = {
  canonicalCardId: "card.hash-b159649107e1268bfb45d5d2c64def273ae76898db17907192d8e25e1d7526ef",
  rulesetVersion: "core-1.5",
  status: "executable",
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
            objects: {
              kind: "constant",
              value: { kind: "target", id: "defiant-dance.unit" }
            },
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
            objects: {
              kind: "constant",
              value: { kind: "target", id: "defiant-dance.another-unit" }
            },
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
