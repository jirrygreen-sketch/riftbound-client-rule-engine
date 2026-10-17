import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Decree of Focus（ven-040-166）— Spell，1 Energy，无印刷 Power，领域 Calm。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-040-166，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
 *   "Choose a friendly unit that's in combat with an enemy Fury (:rb_rune_fury:) unit " +
 *   "or that's being chosen by an enemy Fury spell. Give it +4 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）是许可类关键词，按契约 3.7 由 keywords/Reaction.ts 展开。
 * - "Choose a friendly unit"：具体选择一个 Board 单位，按 355.5/355.7/355.9.a.1 是 Target；
 *   "friendly" 是控制器限制（355.9.b / 190.6.d 的 you）。
 * - "that's in combat with an enemy Fury unit or that's being chosen by an enemy Fury
 *   spell"：740.2.c 的 in combat 要求单位占据战斗中的战场并持有战斗 designation，
 *   再要求交战对方是敌方 Fury 单位；析取的另外一支要求读取敌方 Fury 法术当前的链目标计划。
 * - "Give it +4 :rb_might: this turn"：143.2.a 的有效 Might 修正，属 arithmetic 图层
 *   （475–478），到期于 317.2.c；由已合入的 continuous.might 承担（RIFT-258），
 *   不是 702 的 Buff 计数。
 *
 * status = judge-required，2026-10-17 复核（RIFT-683）。整卡唯一的缺口仍是目标合法性，
 * 已在下方 judgeReason 写清；+4 Might 正文的真实执行证据见
 * test/cards/templates/keyword-play-continuous-might-683.test.mjs 与本卡 golden。
 * targetRestriction 与 rad/decree-of-insight、rad/decree-of-discord 同一约定：具名描述，
 * 由生产过滤器适配器显式拒绝（programs/filters.ts translateObjectFilter 抛
 * Unsupported filter field targetRestriction），不会被当成可求值限制。
 */
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
              // being chosen by an enemy Fury spell"（见 judgeReason）。生产过滤器
              // 会拒绝该键，因此它不会被静默当成可用限制，也不会让所有友方单位成为合法目标。
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
    "整卡唯一缺口是目标合法性谓词，不近似实现（740.2.c、355.9.b、355.7）：" +
    "(1)「in combat with an enemy Fury unit」需要 740.2.c 的交战状态与交战对方身份/领域关系；" +
    "ObjectSnapshot 只有 combatRole（attacker/defender），既没有交战对象、也没有对方领域，更没有该关系谓词；" +
    "(2)「being chosen by an enemy Fury spell」需要读取敌方 Fury 法术当前 Finalize 目标计划，该计划属引擎内部；" +
    "TargetSpec.filter 是键的合取，表达不了该析取。" +
    "targetRestriction 只是描述：实测 programs/filters.ts 的 translateObjectFilter 拒绝该字段（Unsupported filter field targetRestriction），" +
    "因此它不会被当成可用限制，也不会让任意友方单位成为合法目标。" +
    "+4 Might 正文（143.2.a arithmetic 图层、317.2.c 回合末到期）已由 continuous.might 真实执行，" +
    "证据在 test/cards/templates/keyword-play-continuous-might-683.test.mjs 与本卡 golden（含目标失效 ignored 边界）；不代表目标限制可执行。" +
    "依赖：TargetSpec 的析取/关系谓词（in-combat-with、chosen-by-enemy-spell）。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a friendly unit that's in combat with an enemy Fury (:rb_rune_fury:) unit or that's being chosen by an enemy Fury spell. Give it +4 :rb_might: this turn."
} satisfies CardProgram;
