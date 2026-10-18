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
 * - "Choose a friendly unit"：按 355.5/355.7/355.9.a.1 是 Target；"friendly" 是控制器限制。
 * - "that's in combat with an enemy Fury unit or that's being chosen by an enemy Fury
 *   spell"：740.2.c 的 in combat 要求交战对方是敌方 Fury 单位；析取的另外一支要求读取
 *   敌方 Fury 法术当前的链目标计划。
 * - "Give it +4 :rb_might: this turn"：143.2.a 的有效 Might 修正，属算术图层
 *   （475–478），到期于 317.2.c，由已合入的 continuous.might 承担。
 *
 * status = judge-required（2026-10-18 M2 复核，两处当前缺口，均为实测，不近似实现）：
 * 1. 目标合法性谓词没有形态：(a) “in combat with an enemy Fury unit” 需要 740.2.c 的交战
 *    状态与交战对方身份/领域关系；ObjectSnapshot 只有 combatRole，既没有交战对象也没有对方
 *    领域，更没有该关系谓词（combatRole 本身也没有生产写入方）；(b) “being chosen by an
 *    enemy Fury spell” 需要读取敌方 Fury 法术当前的 Finalize 目标计划，该计划属引擎内部；
 *    TargetSpec.filter 是键的合取，表达不了该析取。
 * 2. 由于上面那个键，整张牌连打出都绑不上：实测 programs/play.ts 的 describePlay 对
 *    本卡的 play body 抛 ProgramBindingError('Unsupported filter field targetRestriction')，
 *    所以生产路径上这张法术无法进入链。targetRestriction 只是描述性备忘，不当作可求值限制；
 *    它也不是失败的“原因”，而是同一缺口在 IR 里的记录形态。
 * +4 Might 正文（143.2.a arithmetic 图层、317.2.c 回合末到期）已由 continuous.might 真实执行，
 * 证据在 test/cards/templates/keyword-play-continuous-might-683.test.mjs 与本卡 golden
 * （含目标失效 ignored 边界）；不代表目标限制可执行。
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
    "两处当前缺口，均实测、不近似实现（740.2.c、355.9.b、355.7）：(1) 目标合法性谓词没有形态——" +
    "(a)「in combat with an enemy Fury unit」需要 740.2.c 的交战状态与交战对方身份/领域关系；ObjectSnapshot 只有 combatRole，" +
    "既没有交战对象也没有对方领域，更没有该关系谓词，且 combatRole 没有生产写入方（engine-runtime/host.ts 恒定 null）；" +
    "(b)「being chosen by an enemy Fury spell」需要读取敌方 Fury 法术当前 Finalize 目标计划，该计划属引擎内部；" +
    "TargetSpec.filter 是键的合取，表达不了该析取。" +
    "(2) 因为该描述键占位在目标 filter 上，本卡的生产打出绑定直接失败：实测 describePlay（programs/play.ts 经 " +
    "translateObjectFilter）抛 ProgramBindingError('Unsupported filter field targetRestriction')，法术无法进链。" +
    "targetRestriction 只是缺口记录形态，不会被当成可求值限制（它确实被翻译器拒绝，也绝不会让任意友方单位成为合法目标）。" +
    "+4 Might 正文（143.2.a arithmetic 图层、317.2.c 回合末到期）已由 continuous.might 真实执行，" +
    "证据在 test/cards/templates/keyword-play-continuous-might-683.test.mjs 与本卡 golden（含目标失效 ignored 边界）；不代表目标限制可执行。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a friendly unit that's in combat with an enemy Fury (:rb_rune_fury:) unit or that's being chosen by an enemy Fury spell. Give it +4 :rb_might: this turn."
} satisfies CardProgram;
