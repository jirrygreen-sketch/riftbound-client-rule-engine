import type { CardProgram } from "../../ir/index.js";

/**
 * Solari Chief (ogn-225-298) — Unit, 5 energy + 1 Order power, Might 4。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-225-298）：
 *   When you play me, choose an enemy unit. If it is stunned, kill it. Otherwise, stun it.
 *   (It doesn't deal combat damage this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 「When you play me」：card-played 时点、来源为自身（383/420.4.a）。
 * - 「choose an enemy unit」：355.9.b 的按特征选择（enemy unit）→ Finalize 目标（355.8）；
 *   355.5 的具体对象选择在 Finalize 完成，结算时用 359.3.e 重验。
 * - 「If it is stunned, kill it. Otherwise, stun it.」：以选定目标的当前 stunned 状态分流的条件从句
 *   （383.2.a.1 的附加条件只作用于所在指令；355.5.a 的类型化例子见 “Stun a unit at a battlefield”）。
 * - 424.1/424.1.a：Stunned 是二元状态，已 Stunned 的单位不能被再次 Stun；424.2 是受限动作。
 * - 429/429.2.a：Kill 是永久物从场上进入弃牌堆的动作（本卡用已合入的 effect.kill）。
 *
 * 结构（契约 3.1/3.2）：
 * - body[0] 在 condition「目标 stunned == true」下 effect.kill；
 * - body[1] 在 condition「目标 stunned == false」下 effect.stun。
 * 两条指令都绑定同一个 TargetSpec（chosen-enemy），Finalize 只做一次选择；条件只作用于各自指令
 * （契约 3.4），另一条不会执行。两条分支互斥，因此不会出现“先杀再横置”的重复结算。
 *
 * status = executable：两条分支的原语与条件表达都已存在，golden 用解释器 + 参考内核真实执行
 * stunned → kill、未 stunned → stun，以及目标失效边界。生产 chain 适配器对 effect.stun 的
 * literal target 登记仍有既有引擎侧跟进项，但同一口径的 Solari Shieldbearer 与 Rune Prison
 * 已将 effect.stun 卡标为 executable；该适配器问题不改变本卡已具备的语义执行证据。
 */
const solariChief = {
  canonicalCardId: "card.hash-be8b1014b9c44e6e9840a89206dc75baa41dd3cf997436c7e72b3f4395a7fdb0",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "solari-chief.kill-if-stunned",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "chosen-enemy" } },
          targets: [
            {
              id: "chosen-enemy",
              filter: { type: "unit", controller: "opponent", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { target: "chosen-enemy" },
              property: "stunned"
            },
            operator: "eq",
            right: { kind: "constant", value: true }
          }
        },
        {
          id: "solari-chief.stun-otherwise",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "chosen-enemy" } },
          targets: [
            {
              id: "chosen-enemy",
              filter: { type: "unit", controller: "opponent", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { target: "chosen-enemy" },
              property: "stunned"
            },
            operator: "eq",
            right: { kind: "constant", value: false }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play me, choose an enemy unit. If it is stunned, kill it. Otherwise, stun it. " +
    "(It doesn't deal combat damage this turn.)"
} satisfies CardProgram;

export default solariChief;
