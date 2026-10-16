import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mesmerize (ven-052-166) — Spell, 1 energy + 1 Power, no printed Might, domain Mind.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-052-166，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
 *   "Choose one —\n" +
 *   "Return a friendly unit to its owner's hand.Give an enemy unit -2 :rb_might: this turn."
 *
 * ⚠ 数据问题（不改数据，仅报告）：本项目其它“Choose one —”能力文本在括号后都有换行分隔符
 * （见 rad-013-167 Lost to the Sands 的 "battlefield.Kill" 同类残留），本印刷的两个模式之间
 * 只有句点、没有空格或换行（"...owner's hand.Give an enemy..."）。sourceText 仍逐字保留
 * catalog 字节；能力结构按文本显然包含的两个模式编写，不擅自改写数据。
 *
 * 规则依据（Core Rules v1.5）：
 * - [Reaction]（813.1 / 813.1.c）：许可类关键词，可在任意玩家的 Closed State 打出；
 *   卡侧只声明 keyword（契约 3.7），展开与链许可由 keywords/Reaction.ts 与 chain/ 负责。
 * - "Choose one —"：355.3 规定模式列表在 Finalize 期间选择；契约 3.9 冻结为一个
 *   choice.mode 节点（count 1、different true），被选模式体在原位按声明顺序执行
 *   （158.1），不写成 choice + linkedTo。
 * - 模式 1 "Return a friendly unit to its owner's hand."：单位在 Board（公开区域）且被
 *   明确指名，因此是 Target（355.7 / 355.9.a.1 / 355.10）。返手是 416 的
 *   return-to-hand 动作，用 effect.zone 的 to: "hand" 提交（同 ogn-104-298 Retreat）。
 * - 模式 2 "Give an enemy unit -2 :rb_might: this turn."：敌方单位是 Target
 *   （355.7 / 355.9.b）；"-2 Might this turn" 是带回合期限的临时 Might 修改，属算术图层
 *   （continuous.might + 317.2.c 到期），effect.buff 文件头明确临时 Might 修改绝不归
 *   Buff 计数器。本卡没有印刷下限（143.2.c 的“小于 0 按 0 处理”是一般规则），故不写
 *   minimum。
 *
 * status = judge-required。两块依赖，均不近似实现：
 * 1. 模式 1 的返手目标在程序里已按 355.7/355.9.a.1 声明（effect.zone 已合入）。
 * 2. 模式 2 的临时 Might 修改没有已合入的执行原语：契约 3.6 的封闭 GameAction 集合没有
 *    Might 修改动作，effects/instructions/ 也没有注册通过 ResolveContext.addContinuous
 *    创建 continuous.might 的 op（layers 能求值，卡牌侧无入口），依赖 RIFT-91。
 * 3. 模式列表本身还有生产接线缺口：chain/engine.ts 的 assertFinalizationSurface 对
 *    instruction.op === "choice.mode" 直接抛 ChainContractBlockedError（"Mode choices
 *    require a Finalize/Resolve choice-plan adapter"），因此模式选择目前无法在真实链上
 *    落地（同 rad-013-167 Lost to the Sands 的登记）。
 * 已支持部分：模式 1 的 effect.zone 返手在 golden 中用解释器 + 参考内核真实执行；
 * 模式 2 与模式列表的生产接线写 test.todo。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    kind: "play",
    cost: {
      kind: "cost.printed",
      energy: { kind: "constant", value: 1 },
      // 印刷 1 点 Mind Power（domains: ["Mind"]）；power 不为 null，因此写出该分量。
      power: { kind: "constant", value: 1 }
    },
    body: [
      {
        // 355.3 / 契约 3.9：二选一的模式列表，count 1、different true。
        id: "mesmerize.choose-one",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              {
                id: "mesmerize.return-mode",
                body: [
                  {
                    // "Return a friendly unit to its owner's hand." — 416 的返手动作由
                    // effect.zone 的 to: "hand" 提交（108.6 的 owner routing 在动作层）。
                    id: "mesmerize.return-unit",
                    op: "effect.zone",
                    args: {
                      target: { kind: "constant", value: "mesmerize.friendly-unit" },
                      to: { kind: "constant", value: "hand" }
                    },
                    targets: [
                      {
                        id: "mesmerize.friendly-unit",
                        filter: { type: "unit", zone: "board", controller: "self" },
                        min: 1,
                        max: 1,
                        selection: "one"
                      }
                    ]
                  }
                ]
              },
              {
                id: "mesmerize.debuff-mode",
                body: [
                  {
                    // "Give an enemy unit -2 Might this turn." — 算术图层的临时 Might
                    // 修正，end-of-turn 到期；创建该持续效果的 op 尚未合入（见 judgeReason 第 2 点）。
                    id: "mesmerize.give-minus-2-might",
                    op: "continuous.might",
                    args: {
                      amount: { kind: "constant", value: -2 },
                      duration: { kind: "constant", value: "this-turn" },
                      target: { kind: "constant", value: "mesmerize.enemy-unit" }
                    },
                    targets: [
                      {
                        id: "mesmerize.enemy-unit",
                        filter: { type: "unit", zone: "board", controller: "opponent" },
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
];

export default {
  canonicalCardId:
    "card.hash-754aa7addecbea1ffa38ad32f6fbc52273f58dffb461b7a3b18b936fa4eee165",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) 模式 2「Give an enemy unit -2 :rb_might: this turn」是带回合期限的临时 Might 修改，" +
    "属算术图层（317.2.c 到期）：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 也没有注册通过 " +
    "ResolveContext.addContinuous 创建 continuous.might 的原语（layers 能求值，卡牌侧无入口），effect.buff 只处理 CR 702 的 " +
    "Buff 计数，不能近似；本卡没有印刷下限（143.2.c 的“小于 0 按 0 处理”是一般规则），故不写 minimum。" +
    "(2) 模式列表的生产接线未合入：chain/engine.ts 的 assertFinalizationSurface 对 instruction.op === \"choice.mode\" 直接抛 " +
    "ChainContractBlockedError（\"Mode choices require a Finalize/Resolve choice-plan adapter\"），355.3 的 Finalize 模式决定尚无 " +
    "链上落地路径（同 rad-013-167 Lost to the Sands 的登记）。已支持部分：模式 1「Return a friendly unit to its owner's hand」" +
    "（416 返手，effect.zone 已合入，目标按 355.7/355.9.a.1 声明）由 golden 真实执行。" +
    "依赖：RIFT-91（continuous.might 卡牌侧入口与到期）、RIFT-90（Finalize/Resolve 选择计划适配）。" +
    "另见数据问题：本地 catalog 的两个模式之间缺分隔符（\"...owner's hand.Give an enemy...\"），sourceText 逐字保留、未改写数据。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose one —\n" +
    "Return a friendly unit to its owner's hand.Give an enemy unit -2 :rb_might: this turn."
} satisfies CardProgram;
