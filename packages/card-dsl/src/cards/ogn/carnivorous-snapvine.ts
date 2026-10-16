import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Carnivorous Snapvine (ogn-149-298) — Unit（能量 5，力量 2，Might 6，Body；Shadow Isles）。
 *
 * 原文："When you play me, choose an enemy unit at a battlefield. We deal damage
 * equal to our Mights to each other."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1："When you play me…" 是 Play Effect（时点 card-played，
 *   359/407），在与本卡 FINAL 后进入链。
 * - 355.10 / 355.9.a.1："an enemy unit at a battlefield" 是选择型引用 → 目标
 *   （TargetSpec），合法性在 Finalize 锁定、Resolve 重验（359.3.e）。
 * - 418.6.b.3 例 Challenge（"They deal damage equal to their Mights to each
 *   other."）：伤害来源是**被选中的单位**而不是法术/能力本身；两名单位各自造成
 *   等于自身 Might 的伤害。
 * - "our Mights" 在第 2 次结算时读取两单位当时的 Might（359.3.f.2：指令执行时
 *   检查引用信息；Stupefy 例说明读取的是当时值）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 以被选单位为伤害来源需要把"目标对象的引用"与"该对象当时的 Might"分别交给
 *   effect.damage 的 source/amount。ObjectSelector 只提供 {target}/{pick}/{linked}/
 *   self/source；以目标为选择符的 object-property 只能读特征（如 might），读不到
 *   运行时 ObjectRef；"对象→引用"没有已合入表达式（sfd Strike Down 的
 *   "picked-unit.might" 缺口同源）。
 * - 两次互相伤害的先后/同时性与"第一个单位被消灭时第二个是否仍读取最后已知信息"
 *   由 359.3.e.13（同一条指令内的动作造成的离区回看）处理，属原语+解释器语义，
 *   本卡不能自己拆成两条指令冒充同时结算。
 * 依赖：ObjectSelector/Expr 的"选择符→引用"读取（picked/target ref）与一条指令内
 * 双方互伤的同时性模型；不近似实现（不写死双方 Might 数值、不拆成两条指令）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "snapvine.reciprocal-damage",
        op: "effect.damage",
        args: {
          amount: {
            kind: "object-property",
            object: { target: "snapvine.enemy-unit" },
            property: "might"
          },
          source: {
            kind: "object-property",
            object: { target: "snapvine.enemy-unit" },
            property: "ref"
          },
          target: { kind: "constant", value: "snapvine.self" }
        },
        targets: [
          {
            id: "snapvine.enemy-unit",
            filter: { type: "unit", controller: "opponent", location: { type: "battlefield" } },
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
  canonicalCardId: "card.hash-0198949b45425f8cf47078623d6647cf083dc1971553ed77552f307b6ca7031a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "以被选单位为伤害来源的互伤不能诚实表达（418.6.b.3 例 Challenge）：ObjectSelector " +
    "只有 self/source/{target}/{pick}/{linked}，以目标为锚的 object-property 只能读特征" +
    "（可读 might），读不到运行时 ObjectRef，因此 effect.damage 的 source 无法指向被选" +
    "单位（与 sfd Strike Down 的 picked-unit 引用缺口同源）。另外" +
    "“WE deal damage … to each other” 是同一 Deal 动作的双向伤害，其相互同时性/先后与" +
    "一方被消灭后另一方读取最后已知 Might（359.3.e.13）属原语与解释器语义，" +
    "把一条指令拆成两条会改变结算，属近似实现。依赖：选择符→引用的表达式读取与" +
    "单指令互伤模型。不实现近似版。",
  abilities,
  sourceText:
    "When you play me, choose an enemy unit at a battlefield. We deal damage equal to our Mights to each other."
} satisfies CardProgram;

export default program;
