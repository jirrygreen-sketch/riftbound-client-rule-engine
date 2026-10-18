import type { CardProgram } from "../../ir/index.js";

/**
 * Stare Down (unl-107-219) — Spell, 2 energy, no printed power, Body.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-107-219, verbatim):
 *   "Choose a friendly unit and a battlefield. Move all enemy units at that
 *    battlefield with less Might than the chosen unit to their base. Gain 1 XP."
 *
 * Rules evidence (Core Rules v1.5):
 * - "Choose a friendly unit and a battlefield" chooses two specific Board
 *   objects, so both are targets (355.5 / 355.7 / 355.9.a.1); a Battlefield is a
 *   Game Object in a public zone (170 / 355.10.a.1), the same reading the merged
 *   rad/for-demacia program records for "Choose a battlefield".
 * - "Move all enemy units at that battlefield with less Might than the chosen
 *   unit" is a programmatically selected set (355.10.d: "Kill all units at a
 *   battlefield" targets the battlefield but no units), so those units are not
 *   targets and must not be declared as TargetSpecs. Two things are missing for
 *   it:
 *   1. the merged effect.move primitive only consumes already-selected objects
 *      (source / target spec / pick spec / a `choose` non-target selection). It
 *      has no "all objects matching a filter" form, and expressing the printed
 *      programmatic set as a `choose` selection would silently turn it into a
 *      player choice (the opposite of 355.10.d.1's "no choice is ever
 *      possible");
 *   2. "at that battlefield" needs the chosen battlefield's runtime LocationRef
 *      and "less Might than the chosen unit" needs a numeric comparison against
 *      another chosen object's effective Might. The frozen ObjectFilter
 *      vocabulary has neither (ogn/gust records the same gap for a Might
 *      threshold), and no merged expression reads another object's Might
 *      (sfd/soraka-wanderer records that gap).
 *   The set is therefore kept as a descriptive, fail-closed marker: the merged
 *   effect.move parser rejects `{ kind: "set-selector", ... }` outright instead
 *   of moving the wrong units (cataclysm / demon-shade use the same device for
 *   their destination selectors, and the golden test asserts the rejection).
 * - "to their base" is each moved unit's own base, which is the merged
 *   `controller-base` destination (effect.move), so only the object set is
 *   blocked.
 * - "Gain 1 XP" is the merged effect.xp primitive (728-730.1); the implicit
 *   recipient is this ability's controller (190.6.d) and 729.2 keeps the amount
 *   public.
 *
 * status = judge-required (README section 2). The Move is not approximated: the
 * descriptive set marker cannot execute, and the XP half is real and executed by
 * the golden test.
 *
 * Dependencies: an untargeted set/query object selection for effect.move plus a
 * Might comparison predicate and a location anchor read from another selected object.
 */
export default {
  canonicalCardId:
    "card.hash-b01f4d5df7d2f8e495a921ff9e1382d11332309f969c740e6a72d9d73bf8ebd2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Move all enemy units at that battlefield with less Might than the chosen unit」无法执行，两处缺口均不近似实现：" +
    "(1) 这组单位按 355.10.d 是按特征程序化选出的集合（例：Kill all units at a battlefield 只以战场为目标），" +
    "不是目标；而已合入的 effect.move 只消费已经选定的对象（source / TargetSpec / PickSpec / 非目标 choose 选择），" +
    "没有「全部匹配过滤器的对象」形式；若写成 choose 选择，就把它偷偷变成玩家选择（与 355.10.d.1「永不可能有选择」相反）。" +
    "本文件把该集合保留为描述性且 fail-closed 的标记 { kind: \"set-selector\", ... }：effect.move 的解析器会直接拒绝它，" +
    "不会误移单位（cataclysm / demon-shade 的目的地选择器同一做法），golden 断言该拒绝。" +
    "(2)「at that battlefield」需要从所选战场读出运行期 LocationRef（sameLocationAs），「less Might than the chosen unit」需要与另一个已选对象的" +
    "有效 Might 做数值比较（mightLessThan）；冻结的 ObjectFilter 词表没有这两种谓词（ogn/gust 记录了 Might 阈值的同一缺口），" +
    "也没有任何已合入表达式能读取他者 Might（sfd/soraka-wanderer 记录该缺口）。" +
    "依赖：effect.move 的无目标集合/查询选择、Might 比较谓词与从另一目标读取地点的锚点；" +
    "当前 location target 选择只锁定所选战场，不能替代这些对象集合与跨对象比较。" +
    "已合入并由 golden 真实执行的部分：两个目标声明（友方单位 + 战场）与「Gain 1 XP」（effect.xp，728–730.1）。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "stare-down.move-enemy-units",
          op: "effect.move",
          args: {
            // 描述性集合标记（非可执行对象选择符）：见 judgeReason 第 (1) 点，
            // effect.move 会拒绝该形状而不是移动错误的单位。
            objects: {
              kind: "constant",
              value: {
                kind: "set-selector",
                filter: {
                  type: "unit",
                  controller: "opponent",
                  zone: "board",
                  sameLocationAs: { target: "stare-down.battlefield" },
                  mightLessThan: { target: "stare-down.friendly-unit" }
                }
              }
            },
            // 「to their base」= 各被移单位自己的基地（controller-base）。
            to: { kind: "constant", value: "controller-base" },
            linkKey: { kind: "constant", value: "movedEnemyUnits" }
          },
          targets: [
            {
              id: "stare-down.friendly-unit",
              // 「a friendly unit」：355.7 的具体选择，Finalize 锁定。
              filter: { type: "unit", controller: "controller", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "stare-down.battlefield",
              // 170 / 170.7 / 355.10.a.1：战场是游戏对象，可被具体选择。
              filter: { type: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 「Gain 1 XP」：effect.xp（728–730.1），获得者缺省为本能力控制者
          // （190.6.d）。本卡没有引用上一条的结果，因此不写 linkedTo
          // （359.3.e.14 要求真实的指代关系）。
          id: "stare-down.gain-xp",
          op: "effect.xp",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "Choose a friendly unit and a battlefield. Move all enemy units at that battlefield with less " +
    "Might than the chosen unit to their base. Gain 1 XP."
} satisfies CardProgram;
