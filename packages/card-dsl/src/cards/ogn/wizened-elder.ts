import type { CardProgram } from "../../ir/index.js";

/**
 * Wizened Elder (ogn-065-298) — Unit, 4 energy, Might 4, Calm, Ionia.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-065-298):
 *   While I'm buffed, I have an additional +1 :rb_might:.
 *
 * Rules evidence (Core Rules v1.5):
 * - The text is a Conditional Passive Ability recognized by "while" (364.3,
 *   364.3.a); passive abilities of permanents are active while on the Board
 *   (365.1).
 * - "buffed" is defined by 702.2.a: a unit is Buffed for as long as the buff
 *   remains on it, and each Buff contributes +1 Might individually (703). The
 *   printed ability adds one further, separate +1 Might on top of that.
 *
 * Status: judge-required.
 * - The additional +1 Might is a continuous Might modification; the closed
 *   GameAction set of contract 3.6 has no Might-modification action and
 *   effect.buff only places/removes the Buff counter itself (each Buff already
 *   contributes its own +1 Might through the layers arithmetic, 703). Adding a
 *   second Buff counter would be a different game object and is illegal
 *   anyway (702.3: at most one Buff per unit), so it cannot stand in for the
 *   printed +1.
 * - No merged code turns a card program's static ability into a registered
 *   layer effect, and the layers engine has no "is buffed" predicate
 *   (702.2.a) for the condition: the merged filter matcher understands
 *   type/zone/controller/tag/state/characteristics, and the layers
 *   conditionMatches only resolves always/never/type/has-tag/has-keyword.
 * Dependencies: RIFT-91 (layers-continuous: continuous.might + a buffed
 * predicate). Not approximated with a Buff counter.
 */
export default {
  canonicalCardId: "card.hash-16335e499c8dc3283d678e27bfe613e02ef16a6babfe209f953b1959c52fd375",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「While I'm buffed, I have an additional +1 [M]」（364.3.a 的条件被动；702.2.a 的 buffed 定义）不可执行：" +
    "这是独立的持续 Might 修正，契约 3.6 封闭 GameAction 无 Might 修改动作；effect.buff 只放置/移除 Buff 计数器本体" +
    "（每个 Buff 已按 703 各自贡献 +1 Might，702.3 又规定一个单位最多一个 Buff，所以补一个 Buff 计数器既非法也不等价）；" +
    "没有任何合入路径把卡牌程序的 static ability 注册进 layers（RIFT-91），且层引擎/过滤器都没有 buffed 谓词" +
    "（layers 的 conditionMatches 只认 always/never/type/has-tag/has-keyword）。依赖：RIFT-91（continuous.might 与 buffed 谓词）。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: "self",
        amount: { kind: "constant", value: 1 }
      },
      condition: {
        // "while I'm buffed": the unit currently holds a Buff counter
        // (702.2.a). The predicate is named here for the layers consumer;
        // no merged evaluator reads it yet (see judgeReason).
        kind: "expression",
        value: { kind: "constant", value: "self-is-buffed" }
      }
    }
  ],
  sourceText: "While I'm buffed, I have an additional +1 :rb_might:."
} satisfies CardProgram;
