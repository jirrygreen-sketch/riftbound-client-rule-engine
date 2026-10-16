import type { CardProgram } from "../../ir/index.js";

/**
 * Demon Shade（rad-102-167）— Spell，3 能量，无印刷力量，领域 Fury。
 *
 * 原文（packages/card-data/data/deck-catalog.json rad-102-167，逐字；"battlefield.Give" 之间
 * 缺空格与换行是本地数据原样，见任务回复的「数据问题」）：
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n"
 *   "Choose a friendly unit, then choose one —\n"
 *   "Move it to an open battlefield.Give it [Ganking] this turn if there are no open battlefields. "
 *   "(It can move from battlefield to battlefield.)"
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）关键词声明，展开由关键词注册表负责（契约 3.7），卡牌只声明。
 * - 「Choose a friendly unit」是具体对象选择（355.5）；355.10 / 355.9.a.1 使它成为目标
 *   （"unit" 指 Board 上的对象）。两个分支的指令各自声明自己的 TargetSpec：只有被执行的模式
 *   会结算，因此仍然只选择并使用一个友方单位；"then" 所要求的「先选单位、再选模式」
 *   Finalize 顺序属于目标计划（RIFT-90），见 judgeReason 第 4 点。
 * - 「then choose one —」是 355.3 的模式选择：两个互斥模式（移动到 open battlefield /
 *   无 open battlefield 时给 [Ganking]），用 choice.mode 表达（契约 3.9），不写成 choice + linkedTo。
 * - 「an open battlefield」按 170.11.c 是「无单位且无人控制」的战场，属运行期 Location 选择
 *   （355.4 / 355.4.a / 451.1）。
 * - 「Give it [Ganking] this turn」是本回合的关键词授予，需要带 end-of-turn 期限的
 *   continuous.grant-keyword 持续效果（契约 3.4：关键词授予落在 ability 图层）。
 *   reminder 括号是 Ganking 的释义（810.1.b），不是独立指令。
 *
 * status = judge-required（不近似实现）：
 * 1. 目的地不可表达：没有运行期 Location 选择器（target.location 未合入），effect.move 的 to
 *    只接受静态 LocationRef / controller-base / 静态候选列表；"open battlefield" 需要按
 *    170.11.c 在合法战场中筛选并选择。本卡把目的地写成描述性标记，解释器会拒绝该形状而不是
 *    落到错误地点（依赖 RIFT-90 / RIFT-91）。
 * 2. [Ganking] 的本回合授予需要 continuous.grant-keyword（end-of-turn）；该持续效果原语未注册
 *    （与 gem-jammer / forecaster / rumble-hotheaded 同缺口），依赖 RIFT-91。
 * 3. 「if there are no open battlefields」是没有对象的集合谓词：现有 compare（eq/ne/lt/lte/gt/
 *    gte/in）无法对集合表达空判定，也没有 condition.predicate 的集合空判定；本卡不发明语义
 *    （依赖 RIFT-90 的 condition.predicate）。
 * 4. 原文 "Choose a friendly unit, then choose one" 要求先选单位再选模式（355.5 在 355.3 之前），
 *    该 Finalize 顺序属于目标计划与链（RIFT-90 / RIFT-120 后续）；两个分支各自声明一个友方
 *    单位目标，只有被执行的模式会结算。
 *
 * 数据问题（不改数据）："battlefield.Give" 缺空格/换行，两个功能子句被粘在一起；sourceText
 * 按逐字要求保留原样。
 */

/** 描述性目的地标记，不是可执行 LocationRef（见 judgeReason 第 1 点）。 */
const OPEN_BATTLEFIELD = {
  kind: "destination-selector",
  filter: { type: "battlefield", occupied: false, controlled: false }
} as const;

const demonShade = {
  canonicalCardId: "card.hash-c4b9b8b1ea96f69164e5303d652fe97e69e6f81ce7b8f455b1a108203dd67a45",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处依赖未合入，均不近似实现：(1)「an open battlefield」（CR 170.11.c）是运行期 Location 选择" +
    "（355.4 / 355.4.a / 451.1），合并 IR 没有运行期 Location 选择器，effect.move 的 to 只接受静态 " +
    "LocationRef / controller-base / 静态候选列表，本卡只保留描述性目的地标记（依赖 RIFT-90 / RIFT-91）。" +
    "(2)「Give it [Ganking] this turn」需要带 end-of-turn 期限的 continuous.grant-keyword 持续效果，" +
    "该原语未注册（与 gem-jammer / forecaster 同缺口，依赖 RIFT-91）。(3)「if there are no open battlefields」" +
    "是没有对象的集合谓词，现有 compare（eq/ne/lt/lte/gt/gte/in）无法对集合表达空判定（依赖 RIFT-90 的 " +
    "condition.predicate）。(4) 原文 \"Choose a friendly unit, then choose one\" 要求先选单位再选模式" +
    "（355.5 在 355.3 之前），该 Finalize 顺序属于目标计划与链（RIFT-90 / RIFT-120 后续）；两个分支各自" +
    "声明一个友方单位目标，只有被执行的模式会结算。被选友方单位按 355.10 / 355.9.a.1 是目标。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // 「then choose one —」：两个互斥模式（355.3 / 契约 3.9）。两个模式体的指令各自
          // 声明友方单位目标（见 judgeReason 第 4 点）。
          id: "demon-shade.choose-one",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "demon-shade-move",
                  body: [
                    {
                      id: "demon-shade.move-unit",
                      op: "effect.move",
                      args: {
                        objects: {
                          kind: "constant",
                          value: { target: "demon-shade.moved-unit" }
                        },
                        // 描述性标记：运行期 "open battlefield" 选择未合入（见 judgeReason 第 1 点）。
                        to: { kind: "constant", value: OPEN_BATTLEFIELD },
                        amount: { kind: "constant", value: 1 }
                      },
                      targets: [
                        {
                          id: "demon-shade.moved-unit",
                          filter: { type: "unit", controller: "controller" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "demon-shade-grant",
                  body: [
                    {
                      id: "demon-shade.grant-ganking",
                      op: "continuous.grant-keyword",
                      args: {
                        keyword: { kind: "constant", value: "Ganking" },
                        duration: { kind: "constant", value: "end-of-turn" }
                      },
                      targets: [
                        {
                          id: "demon-shade.granted-unit",
                          filter: { type: "unit", controller: "controller" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "Choose a friendly unit, then choose one —\n" +
    "Move it to an open battlefield.Give it [Ganking] this turn if there are no open battlefields. " +
    "(It can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default demonShade;
