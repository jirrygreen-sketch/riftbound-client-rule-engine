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
 *   Finalize 顺序属于目标与模式选择计划（RIFT-358），见 judgeReason 第 4 点。
 * - 「then choose one —」是 355.3 的模式选择：两个互斥模式（移动到 open battlefield /
 *   无 open battlefield 时给 [Ganking]），用 choice.mode 表达（契约 3.9），不写成 choice + linkedTo。
 * - 「an open battlefield」按 170.11.c 是「无单位且无人控制」的战场，属运行期 Location 选择
 *   （355.4 / 355.4.a / 451.1）。
 * - 「Give it [Ganking] this turn」是本回合的关键词授予，需要带 end-of-turn 期限的
 *   continuous.grant-keyword 持续效果（契约 3.4：关键词授予落在 ability 图层）。
 *   reminder 括号是 Ganking 的释义（810.1.b），不是独立指令。
 *
 * status = judge-required（2026-10-17 第三轮复核，不近似实现）：
 * 1. 目的地已按 RIFT-357 的合并形状改写为运行期 Location 选择
 *    （Expr kind "location" → kind "choose"，filter { type: battlefield, open: true }），
 *    170.11.c 的 open 谓词与 355.4/355.4.a 的选择语义都已有实现；仍缺的是**候选来源**：
 *    target/location/candidates.ts 的 allRefs 只从「某个对象当前所在地点」、已知玩家的 Base
 *    和调用方显式传入的 LocationState 收集候选，**没有任何已合入调用方传入 locations**
 *    （interpreter.ts 的 prepareLocations / normalizeMoveArguments 都只传 players/opponent/linked），
 *    因此无单位驻守的战场根本不会出现在候选里（170.11.c 的 open 战场正是这种情况），
 *    Location 选择会以 "Location choice has no options" 阻断。golden 用真实解释器断言了该现状：
 *    被单位占据的战场不会通过 open 过滤，也就无法被选中。
 * 2. [Ganking] 的本回合授予用的 continuous.grant-keyword 已合入（RIFT-258，ability 层注册 +
 *    end-of-turn 到期）；缺的是 810.1.c 移动许可的消费方。
 * 3. 「if there are no open battlefields」是没有对象的集合谓词：现有 compare（eq/ne/lt/lte/gt/
 *    gte/in）无法对集合表达空判定，也没有 condition.predicate 的集合空判定；本卡不发明语义
 *    （依赖 RIFT-359 的集合谓词）。
 * 4. 原文 "Choose a friendly unit, then choose one" 要求先选单位再选模式（355.5 在 355.3 之前），
 *    该 Finalize 顺序属于目标与模式选择计划（RIFT-358）；两个分支各自声明一个友方
 *    单位目标，只有被执行的模式会结算。
 *
 * 复核（2026-10-17 第三轮复核）：continuous.grant-keyword 与 CardProgram 绑定路径均已合入；
 * open 战场候选来源、集合空判定、Finalize 顺序和 Ganking 移动许可消费仍未形成完整执行链。
 *
 * 数据问题（不改数据）："battlefield.Give" 缺空格/换行，两个功能子句被粘在一起；sourceText
 * 按逐字要求保留原样。
 */

/** 「an open battlefield」＝170.11.c 的运行期 Location 选择（filter 已有可求值谓词）。 */
const OPEN_BATTLEFIELD = {
  kind: "choose",
  id: "demon-shade.open-battlefield",
  filter: { type: "battlefield", occupied: false, controlled: false }
} as const;

const demonShade = {
  canonicalCardId: "card.hash-c4b9b8b1ea96f69164e5303d652fe97e69e6f81ce7b8f455b1a108203dd67a45",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处当前缺口（2026-10-17 第三轮复核），均不近似实现：" +
    "(1) 目的地已按 RIFT-357 的合并形状写成运行期 Location 选择（Expr kind \"location\"，" +
    "170.11.c 的 open 过滤 { type: battlefield, open: true }，355.4 / 355.4.a / 451.1），" +
    "但候选来源仍未接线：target/location/candidates.ts 的 allRefs 只从对象当前地点、玩家 Base 与调用方传入的 " +
    "LocationState 收集候选，合并的调用方（interpreter.ts prepareLocations / normalizeMoveArguments）都不传 locations，" +
    "因此没有被单位占据的战场（170.11.c 的 open 战场）根本不在候选里，Location 选择会以 \"Location choice has no options\" 阻断。" +
    "(2)「Give it [Ganking] this turn」的 continuous.grant-keyword 已合入（RIFT-258，ability 层注册 + " +
    "end-of-turn 到期）并有真实执行测试；缺的是 810.1.c 的移动许可消费方。(3)「if there are no open battlefields」" +
    "是没有对象的集合谓词，现有 compare（eq/ne/lt/lte/gt/gte/in）无法对集合表达空判定（依赖 RIFT-359 的 " +
    "condition.predicate）。(4) 原文 \"Choose a friendly unit, then choose one\" 要求先选单位再选模式" +
    "（355.5 在 355.3 之前），该 Finalize 顺序属于目标与模式选择计划（RIFT-358）；两个分支各自声明一个友方" +
    "单位目标，只有被执行的模式会结算。被选友方单位按 355.10 / 355.9.a.1 是目标。",
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
                        // 运行期 "open battlefield" 选择（170.11.c）；候选来源缺口见 judgeReason 第 1 点。
                        to: { kind: "location", value: OPEN_BATTLEFIELD },
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
                        duration: { kind: "constant", value: "end-of-turn" },
                        // 已合入原语（RIFT-258）接受的符号选择器形态（契约 3.6）。
                        objects: {
                          kind: "constant",
                          value: { kind: "target", id: "demon-shade.granted-unit" }
                        }
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
