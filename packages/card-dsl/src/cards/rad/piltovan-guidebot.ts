import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Piltovan Guidebot (rad-057-167) — Unit, 4 energy, 3 Might, Mind.
 *
 * 原文："When you play a card, you may have my base Might become equal to that "
 *       "card's Energy cost this turn."
 *
 * 规则依据（CR v1.5）：
 * - "When you play a card"：Play Effect（383.4.a / 420.4.a），时点 card-played；这里的
 *   条件不是打出本卡，而是"你打出任意一张牌"，故 filter 只限定玩家（能力控制者），
 *   不加 self 过滤。
 * - "may"：按契约 3.9（“可以……”用 choice.optional 把被选指令包进 body）。
 * - "my base Might become equal to that card's Energy cost this turn"：
 *   143.2.a 明确区分 Printed / Base / Effective 三种 Might，"base Might becomes X"
 *   是 **Trait-Altering 层** 的设值（CR 143.2.a 的示例正是 "Its base Might becomes 5
 *   this turn."，见 475 Layers），到期于本回合结束（105 / 318 的清理）。
 * - "that card's Energy cost"：被触发事件中被打出的那张牌（trigger payload 的 object）；
 *   其 Energy cost 是印刷费用特征（163.1 的 Energy 数值）。185.3.a.1：token 无费用但
 *   在各类用途上按 0 处理。
 *
 * status 判定（README 第 2 节）：judge-required。缺口：
 * 1. Trait 层 Base Might 设值没有已注册的卡牌侧原语（continuous.base-might /
 *    set-base-might；LayerEngine 的 set-might 分支属 arithmetic 层，且只消费
 *    ResolveContext.addContinuous 注册的 ContinuousEffectSpec，CardProgram static 未接线）；
 * 2. "that card's Energy cost" 需要把触发事件中被打出的牌引用带进结算上下文：
 *    ResolveContext 只有 source / target / pick / linked 这些选择器，没有"触发事件对象"
 *    访问器与印刷费用读取（cost.printed 亦未注册）；
 * 3. "this turn" 的到期处理依赖持续效果期限（RIFT-91 的 layers/continuous 与后续原语批次）。
 * 依赖：RIFT-91（layers-continuous）+ 触发体上下文/印刷费用读取接线（无已分配任务号）。
 * 不近似实现：不用 Buff counter 或临时 Might 加算代替 Base Might 设值。
 */

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // "When you play a card"：打出任意一张牌都触发；"you" 由触发管线按能力控制者解析。
      filter: { event: "card-played", filter: { player: "controller" } }
    },
    // 触发本身是强制的（"When you play a card"），"you may" 由 choice.optional 承担。
    optional: false,
    body: [
      {
        id: "piltovan-guidebot.may-set-base-might",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Have my base Might become equal to that card's Energy cost this turn?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "piltovan-guidebot.set-base-might",
                // Trait 层 Base Might 设值（143.2.a / 475）+ 本回合结束到期；
                // 原语未注册，amount 用描述性常量记录语义（见 judgeReason）。
                op: "continuous.base-might",
                args: {
                  mode: { kind: "constant", value: "set" },
                  layer: { kind: "constant", value: "trait" },
                  source: { kind: "constant", value: "played-card-energy-cost" },
                  duration: { kind: "constant", value: "end-of-turn" },
                  target: { kind: "constant", value: "piltovan-guidebot.self" }
                },
                targets: [
                  {
                    id: "piltovan-guidebot.self",
                    filter: { type: "unit", object: "self" },
                    min: 1,
                    max: 1,
                    selection: "one"
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

const program = {
  canonicalCardId:
    "card.hash-615e60700f249a984f869bffcbf2ce12e1b4090a85115e2a97fc5432e1df1fc0",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「my base Might becomes equal to that card's Energy cost this turn」需要三处未合入支持：" +
    "(1) Trait-Altering 层的 Base Might 设值原语（143.2.a/475；continuous.base-might 未注册，" +
    "LayerEngine 只消费 ResolveContext.addContinuous 注册的持续效果，CardProgram static 未接线）；" +
    "(2) 触发事件中被打出的牌引用与其印刷 Energy cost 的读取（ResolveContext 没有触发事件对象访问器，" +
    "cost.printed 亦未注册）；(3) 本回合结束的持续期限处理（RIFT-91 的 layers/continuous 与后续原语批次）。" +
    "依赖：RIFT-91（layers-continuous）与触发体上下文 / 印刷费用读取接线（无已分配任务号）。" +
    "不近似实现：不用 Buff counter 或临时 Might 加算代替 Base Might 设值。" +
    "「you may」已按契约 3.9 用 choice.optional 包住被选指令。",
  abilities,
  sourceText:
    "When you play a card, you may have my base Might become equal to that card's Energy cost this turn."
} satisfies CardProgram;

export default program;
