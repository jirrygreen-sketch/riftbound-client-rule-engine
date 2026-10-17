import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Bewitching Spirit (unl-121-219) — Unit，能量 3，力量未印刷（power: null），Might 2，
 * 领域 Chaos，标签 Spirit/Shadow Isles。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-121-219，逐字）:
 *   "When you play me, choose a player. They discard 1."
 *
 * 规则依据（CR v1.5）:
 * - "When you play me"：383.4.a / 383.4.a.1 的 Play Effect（420.4.a 在打出完成后触发），
 *   封闭时点 card-played，filter 指向本源自身。
 * - "choose a player"：355.7 规定“选出一个或多个具体 Game Object / Player / Zone 施加
 *   影响”就是 Targeted（除非本节另有豁免）；355.9.a 把玩家列为合法目标。355.10 的豁免
 *   都不适用（不是非公开区域的牌、不是纯限制/费用/触发条件/替代效果、不是纯程序化集合、
 *   不是必须完成的指令、不是传奇），因此这是**玩家选择**，不是非目标 pick。
 * - "They discard 1"：423.1 的弃牌把牌从手牌移到该玩家自己的 Trash、423.1.a 由该玩家
 *   选择弃哪张、423.4 效果弃牌尽可能弃；用已合入的 effect.discard，player 参数接被选中的
 *   那名玩家（355.10.a 的私有手牌选择是执行者自己的选择）。
 *
 * status 判定（cards/README.md 第 2 节，复核 2026-10-17）：judge-required。两处缺口，均不近似实现：
 * 1. 缺玩家选择原语：契约 3.6 的 `targets()` 只返回 ObjectRef[]，没有玩家目标形状；
 *    PickSpec.options 是静态值数组且 picks() 的返回在解释器里只把对象引用参与特征读取，
 *    "在当前所有玩家中选一个玩家"的重放式选择没有已合入实现（ability-templates 第 4 节
 *    的 target.player 行：“each player 与 choose opponent 不等价”；同 ogn/mindsplitter、
 *    rad/suave-negotiator 的缺口）。本程序用 target.player 占位记录该指令（注册表没有该 op）。

 * 已合入部分：RIFT-257 的 registerProgramTriggers 能注册本卡的 card-played 触发（golden 断言该注册），
 * 后续的 effect.discard 也用解释器 + 参考内核在 provision 出来的“被选中玩家”上真实执行弃牌
 * （包括空手牌时 negated/impossible 仍然尽可能执行，423.4）。
 * `energy: null`/`power: null` 表示无印刷值，未改写成 0。
 *
 * 契约变更请求：请为玩家目标/玩家选择增补 EffectIR 形状（或给 choice 增加 select-players
 * 请求类型），使 355.9.a 的“选一名玩家”可表达；本任务按现有契约只保留占位声明。
 */
const chosenPlayer = "bewitching-spirit.chosen-player";

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body: [
      {
        // 355.7 / 355.9.a：选出一名具体玩家 = 玩家目标。契约 3.6 的 targets() 只有
        // ObjectRef[]，没有玩家形状，故用 target.player 占位（注册表无该 op）。
        id: "bewitching-spirit.choose-player",
        op: "target.player",
        args: {
          selection: { kind: "constant", value: "one" },
          chooser: { kind: "constant", value: "controller" },
          // 选项集合是当前所有玩家；静态 IR 无法列出玩家 id，由选择管线解析。
          options: { kind: "constant", value: "dynamic:players" },
          linkKey: { kind: "constant", value: "chosenPlayer" }
        }
      },
      {
        // "They discard 1"：423.1/423.1.a/423.4，弃牌者是被选中的那名玩家。
        id: "bewitching-spirit.chosen-discards-1",
        op: "effect.discard",
        linkedTo: "bewitching-spirit.choose-player",
        args: {
          amount: { kind: "constant", value: 1 },
          player: {
            kind: "linked-value",
            instructionId: "bewitching-spirit.choose-player",
            key: "chosenPlayer"
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-50e54034f879028f4935bc194153081e4d10c422fae37e9dc5706755d4ecd302",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "一处缺口（复核 2026-10-17，均不近似实现）：缺玩家选择原语——「choose a player」是玩家目标" +
    "（355.7 的 Targeted 定义 + 355.9.a 把玩家列为合法目标；355.10 的豁免都不适用），" +
    "但契约 3.6 的 targets() 只返回 ObjectRef[]、ChoiceRequest 只有 optional/mode/select-objects/order/number，" +
    "PickSpec.options 又是静态值数组，没有“在当前所有玩家中重放式选一个玩家”的已合入实现" +
    "（ability-templates 第 4 节 target.player：each player 与 choose opponent 不等价；同 ogn/mindsplitter、rad/suave-negotiator）。" +
    "本程序用 target.player 占位记录该指令，注册表没有该 op。" +
    "已合入并用真实执行验证的部分：RIFT-257 的 registerProgramTriggers 能注册本卡的 card-played 触发（golden 断言该注册），" +
    "后续的 effect.discard（423.1/423.1.a/423.4）在 provision 出来的“被选中玩家”上真实执行弃牌（golden 执行，含空手牌边界）。" +
    "契约变更请求：为玩家目标/玩家 pick 增补 EffectIR 形状（或给 ChoiceRequest 增补 select-players 类型）。",
  abilities,
  sourceText: "When you play me, choose a player. They discard 1."
} satisfies CardProgram;
