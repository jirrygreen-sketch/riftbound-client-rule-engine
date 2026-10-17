import type { CardProgram } from "../../ir/index.js";

/**
 * Hand of Noxus (ogn-253-298) — Legend, Fury/Order, Darius.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-253-298，逐字）：
 *   :rb_exhaust:: [Reaction], [Legion] — [Add] :rb_energy_1:. (Abilities that
 *   add resources can't be reacted to. Get the effect if you've played a card
 *   this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 404.1.a / 415.5：“:” 前的 :rb_exhaust: 是启动能力的费用（"Exhaust me"）；
 *   合并费用管线支持 { kind: "exhaust", object: "self" }。
 * - 813.1.d / 813.1.c：能力上的 [Reaction] 是 Closed State 启动许可，IR 用
 *   activated.timing = "reaction" 声明；430.3 另允许 Reaction Add 在支付费用时启动。
 * - 430.1 / 430.2.a：[Add] :rb_energy_1: 是 Add 动作，加 1 Energy；触发式/启动式 Add
 *   能力 Finalize 后立即结算、不传递 Priority/Focus（由链与费用管线负责）。
 * - 812.1 / 812.1.b.1 / 812.1.c：[Legion] 是依赖型关键词，功能等价于
 *   “若你本回合已 Finalize 过另一张牌，此牌获得 [Text]”；[Text] 是依赖能力
 *   （本卡的 [Add] 1）。排除本卡自身（812.1.c “与持有 Legion 的牌不同”）需要
 *   HistoryQuery 的 exclude 维度（契约 3.8 第 2 条），由关键词展开提供谓词。
 *
 * status = judge-required：
 * - ResolveContext.history supports turn/action/player/object/exclude queries,
 *   and condition.history / condition.predicate instructions have merged,
 *   but the CardProgram Condition vocabulary has no history/predicate node and
 *   the activated restriction binder cannot consume the Legion gate. The
 *   restriction keeps the printed gate auditable; it is not treated as an
 *   executable comparison.
 * - The ordinary exhaust payment and resource primitive are merged, but the
 *   chain already supports immediate Add, but the activation binder does not classify this resource-adding ability as the
 *   immediate Add window required by 430.2.a/430.3.
 */
const handOfNoxus = {
  canonicalCardId:
    "card.hash-c65f6bc670e670cfb9086db63e2e7e090e36f226d4eb71005c0460c57fe89b49",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Legion 仍缺启动前历史闸门（CR 812.1.b.1 / 812.1.c）：Condition 没有 history/predicate 节点，count 只查询当前对象且忽略 " +
    "cards-finalized-this-turn 的 subject；translateRestriction 不能在支付启动费用前执行历史指令并读取结果。还缺 describeActivate " +
    "按资源增加正文识别 kind: add 的桥接：当前固定生成 activated，不能进入 CR 430.2.a 的即时 Add 结算与 430.3 的 Reaction-Add 支付窗口。",
  abilities: [
    {
      kind: "activated",
      timing: "reaction",
      cost: {
        kind: "activated",
        payments: [{ kind: "exhaust", object: "self" }]
      },
      restriction: {
        kind: "legion",
        value: { kind: "constant", value: "legion-gate" },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "cards-finalized-this-turn",
            filter: { player: "controller", exclude: "self" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      body: [
        {
          id: "hand-of-noxus.add-energy",
          op: "effect.resources",
          args: {
            energy: { kind: "constant", value: 1 }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction], [Legion] — [Add] :rb_energy_1:. (Abilities that add resources " +
    "can't be reacted to. Get the effect if you've played a card this turn.)"
} satisfies CardProgram;

export default handOfNoxus;
