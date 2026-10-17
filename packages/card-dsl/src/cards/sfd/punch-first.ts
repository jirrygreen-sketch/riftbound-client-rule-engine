import type { CardProgram } from "../../ir/index.js";

/**
 * Punch First (sfd-097-221) — Spell, 1 energy + 2 Body power, Fiora deck.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-097-221，逐字）:
 *   "[Action] (Play on your turn or in showdowns.)
 *    Give a unit +5 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）:
 * - "[Action]"（806.1.b/806.1.c、159.2.a）是许可类关键词，卡内只声明；展开由
 *   effects/keywords/Action.ts 负责（契约 3.7）。打出费用 1 energy + 2 Body Power 是
 *   卡牌自身的印刷费用（150.4 / 356.1.c），由打出流程在 Finalize 绑定
 *   （describePlay → cost/plan-values.ts 的 ownDomains 读 source.power 的域）。
 * - "a unit" 是 Board 上一个由结算者具体选择的单位（355.7 / 355.9.a.1 / 355.10），
 *   没有友敌限定，因此 "one" 目标只按 unit + board 过滤。
 * - "+5 :rb_might: this turn" 是本回合到期的临时 Might 修正，属算术图层
 *   （143.2.a、475–478），由已合入的 continuous.might 原语执行（RIFT-258）：它经
 *   ResolveContext.addContinuous 为每个合法对象登记一条 arithmetic 层效果，并按
 *   317.1.a / 468.7.c 的 "this turn" 使用 end-of-turn 期限。绝不用 Buff 计数近似
 *   （702/702.3：Buff 是每单位一个的 +1 计数器，语义不同）。
 * - 目标经 `objects: { kind: "target", id }` 交给原语（同型写法见已合入的
 *   ogn/smoke-screen），选择与重验归 chain Finalize / 解释器目标管线。
 *
 * status = executable：整张卡的印刷能力都有已合入路径——[Action] 声明、印刷费用由打出流程
 * 绑定、正文由已合入的 continuous.might 原语真实登记算术层效果；golden 用解释器 +
 * 参考内核执行程序原始 body，并覆盖目标失效与 0 增量边界。
 * [Action] 的 Showdown 时机准入（contract 3.5 的 canAct 读取图层 timing 许可）与跨回合到期
 * 清理属 chain 侧未接线项，按 README 第 4 节以 test.todo 记录，不改本卡状态。
 */
const punchFirst = {
  canonicalCardId: "card.hash-8d49727ab9ae782b8a21802c9ae0b51e5d712a37a072d991629bfbf3645535b3",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      cost: {
        // 印刷 1 energy + 2 Body Power（356.1.c 由卡牌身份在 Finalize 绑定）。
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "punch-first.give-plus-5-might",
          // "Give a unit +5 Might this turn"：arithmetic 图层 + 本回合到期
          // （143.2.a、317.1.a/468.7.c），登记侧由 continuous.might 原语完成。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 5 },
            duration: { kind: "constant", value: "this-turn" },
            // objects 选择描述符：target 指 TargetSpec id（契约 3.4/3.6）。
            objects: {
              kind: "constant",
              value: { kind: "target", id: "punch-first.unit" }
            }
          },
          targets: [
            {
              id: "punch-first.unit",
              filter: { type: "unit", zone: "board" },
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
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit +5 :rb_might: this turn."
} satisfies CardProgram;

export default punchFirst;

