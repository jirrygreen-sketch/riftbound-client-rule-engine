import type { Ability, CardProgram } from "../../ir/index.js";

/** CR v1.5 317.2.c、355.9.b、740.2.c、813。+4 临时 Might 已支持，复合目标条件仍阻塞整卡。 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 1 }
    },
    body: [
      {
        // "Give it +4 :rb_might: this turn" — 算术图层的临时 Might 修正，
        // end-of-turn 到期；continuous.might 已支持该子效果。
        id: "decree-of-focus.give-plus-4",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 4 },
          duration: { kind: "constant", value: "this-turn" },
          objects: {
            kind: "constant",
            value: { kind: "target", id: "decree-of-focus.friendly-unit" }
          }
        },
        targets: [
          {
            id: "decree-of-focus.friendly-unit",
            filter: {
              type: "unit",
              zone: "board",
              controller: "self",
              // 描述性限制，不是可求值谓词："in combat with an enemy Fury unit or
              // being chosen by an enemy Fury spell"（见 judgeReason 第 2 点）。
              targetRestriction:
                "in-combat-with-an-enemy-fury-unit-or-being-chosen-by-an-enemy-fury-spell"
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-e5eafd33bb50e62c31da83b13c1e44904a8cd4d53760a85e48bbb1fb82d587eb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺目标的复合关系谓词：740.2.c 的 in combat 虽已有 combatRole 状态，但还需“与敌方 Fury 单位交战”的关系及领域成员判断，或读取敌方 Fury 法术正在选择本单位的链目标计划；该目标计划属于引擎内部，TargetSpec.filter 未支持此析取（RIFT-359）。targetRestriction 只是描述，生产过滤器适配器会拒绝该字段；+4 Might 正文已按原始 objects 选择器经解释器执行，不代表目标限制可执行。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a friendly unit that's in combat with an enemy Fury (:rb_rune_fury:) unit or that's being chosen by an enemy Fury spell. Give it +4 :rb_might: this turn."
} satisfies CardProgram;
