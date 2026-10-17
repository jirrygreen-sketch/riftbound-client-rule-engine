import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/** CR v1.5 143.2.a.1、479.4.b/c、827/828。Increase to 是快照后的非负增量，不得把较高 Might 降低到目标值。 */

/** 355.9：目标单位须与来源同处。 */
const chosenUnitId = "dame-the-despoiler.unit-here";

/** 两条战斗触发共用的印文效果：“choose a unit here. Increase my Might to its
 *  Might this turn, then give me +1 :rb_might: this turn.” */
const combatBody = (prefix: string): readonly Instruction[] => [
  {
    // 479.4.b/c：在结算时锁定非负增量；不能把较高的 Might 降低。
    id: `${prefix}.measure-increase`,
    op: "condition.value",
    args: {
      value: {
        kind: "arithmetic", operator: "max", operands: [
          { kind: "constant", value: 0 },
          {
            kind: "arithmetic", operator: "sub", operands: [
              { kind: "object-property", object: { target: chosenUnitId }, property: "might" },
              { kind: "object-property", object: "self", property: "might" }
            ]
          }
        ]
      }
    },
    targets: [{
      id: chosenUnitId,
      filter: { type: "unit", zone: "board", sameLocationAs: "self" },
      min: 1, max: 1, selection: "one"
    }]
  },
  {
    id: `${prefix}.increase-might`,
    op: "continuous.might",
    args: {
      amount: { kind: "linked-value", instructionId: `${prefix}.measure-increase`, key: "value" },
      appliesTo: { kind: "constant", value: "self" },
      duration: { kind: "constant", value: "this-turn" }
    },
    linkedTo: `${prefix}.measure-increase`
  },
  {
    // 独立的后续 +1；前一条无增量或失效不取消这条指令（359.3.e.14.b）。
    id: `${prefix}.plus-1-might`,
    op: "continuous.might",
    args: {
      mode: { kind: "constant", value: "add" },
      amount: { kind: "constant", value: 1 },
      duration: { kind: "constant", value: "this-turn" },
      appliesTo: { kind: "constant", value: "self" }
    }
  }
];

const abilities: Ability[] = [
  {
    // 印刷费 5 Energy + 1 Body Power 见 judgeReason；不伪造启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // 383.4.e：“When I attack” 的 Attack Trigger。
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } }
    },
    optional: false,
    body: combatBody("dame-the-despoiler.attack")
  },
  {
    // 383.4.f：“or defend” 的 Defend Trigger（原文的 or 是触发条件并列）。
    kind: "triggered",
    trigger: {
      at: "defense-declared",
      filter: { event: "defense-declared", filter: { source: "self" } }
    },
    optional: false,
    body: combatBody("dame-the-despoiler.defend")
  }
];

export default {
  canonicalCardId: "card.hash-e48e6f95280cf803b6c17421f260f0c2e1b9e75ab27c4786c880d741b26084c9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺 Empower/Empowered 关键词展开、印刷 5 Energy + 1 Body Power 费用参数与 827.1.c.1 的未 Empowered 起动限制；KeywordAbility 只有 value，programs/keywords 不传 params.cost。ObjectSnapshot 也未暴露 442.1.a 的 Empowered 状态，828.1.c 的依赖能力门控需状态读取/条件谓词（RIFT-359）。programs/filters 还不能翻译目标的 sameLocationAs 符号锚点。此外 combat/ 尚未发出 attack-declared / defense-declared，需要把实际取得战斗身份的路径接入现有事件管线。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_5::rb_rune_body: (:rb_energy_5::rb_rune_body:: Empower me. Use only if not " +
    "Empowered.)\n" +
    "[Empowered][>] When I attack or defend, choose a unit here. Increase my Might to its Might " +
    "this turn, then give me +1 :rb_might: this turn."
} satisfies CardProgram;
