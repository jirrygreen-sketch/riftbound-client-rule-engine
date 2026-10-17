import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Elder Dragon (unl-118-219) — Unit，能量 12，力量 4，Might 10，领域 Body，
 * 标签 Dragon/Demacia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-118-219，逐字）:
 *   "Any amount of your damage is enough to kill enemy units.\n" +
 *   "When you play me, choose up to one enemy unit at each location. Deal 1 to them."
 *
 * 规则依据（CR v1.5）:
 * - 第一句是改变“致死伤害”数额的持续效果：142.4.a 定义 Lethal Damage、142.4.b 的默认
 *   门槛是“非零且大于等于该单位 Might”、142.4.c 明确“某些效果可以改变这个数额”，
 *   规则原文用的例子正是本卡（"Elder Dragon's passive ability reads …"）。因此它是
 *   layers/ 的持续效果（契约 3.4 的 arithmetic 之外的阈值层），不是触发能力。
 * - "When you play me"：383.4.a / 383.4.a.1 的 Play Effect，封闭时点 card-played
 *   （420.4.a 在打出完成后触发），filter 指向本源自身。
 * - "choose up to one enemy unit at each location"：355.5.a/355.5.b 的 Choice（按条件
 *   选具体对象），355.11 的成组目标（Targeting Requirements 由这一组目标共同满足）；
 *   "up to one ... at each location" 是逐 location 分组的 0..1 上限，不是全局上限。
 * - "Deal 1 to them"：418.1（Deal 动作）与 418.6.a（未指定来源时，描述该 Deal 动作的
 *   效果即来源），用已合入的 effect.damage；对象是上一条选出的那组敌方单位。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。两处缺口，均不近似实现：
 * 1. "Any amount of your damage is enough to kill enemy units"（142.4.c）没有已合入的
 *    写入路径：effects/instructions/ 下没有 continuous.lethal-threshold 原语，layers 也没有该阈值层的消费方，
 *    "your damage"（由该玩家标记的伤害）与"enemy units"的作用域无法注册。
 * 2. "up to one enemy unit at each location" 需要逐位置分组的多目标形状：TargetSpec 只有
 *    单一 min/max/selection，没有“按 location 分组、每组各自 0..1”的量词（355.11 的成组
 *    目标由 target.many / TargetPlan 承担）；当前 TargetPlan 只读 filter 与固定的
 *    location 字段，TargetSpec 上的 perLocation 占位键没有任何消费者
 *    （放进 filter 里则会被 programs/filters.ts 视为未知键拒绝），
 *    写成扁平 "up to N" 会在同一 location 选两个单位，属近似实现。
 * 复核撤销的旧缺口：原第 3 点“缺 CardProgram → TriggerRegistration 适配器”已不成立——
 * programs/triggers.ts 能把本卡的 card-played 触发注册进事件管线，
 * "source: self" 与 player: controller 也按来源快照解析；golden 已用 production
 * 绑定 + 真实打出流程跑通注册与结算。
 * body 的 effect.damage（1 点，来源为该效果）已合入，golden 用解释器 + 参考内核真实执行；
 * 目标形状用 perLocation: 1 占位键保留印刷作用域（见第 2 点），不把它当成已可求值。
 *
 * 数据问题（不改数据，仅上报）：本卡的 alternate 印刷 unl-118a-219 在本地 deck-catalog 里
 * tags 只有 ["Dragon"]，主印刷 unl-118-219 是 ["Dragon","Demacia"]；RIFT-42 的复核
 * （docs/plans/survey/unclassified-unl.md 第 29 行）记录两张官方卡图都显示 Demacia·Dragon，
 * alternate 漏了一个标签。
 */
const enemyUnitsPerLocation = "elder-dragon.enemy-unit";

const body: readonly Instruction[] = [
  {
    id: "elder-dragon.deal-1",
    op: "effect.damage",
    args: {
      amount: { kind: "constant", value: 1 },
      // "to them"：上一条选出的那组敌方单位（本条指令的 TargetSpec）。
      target: { kind: "constant", value: enemyUnitsPerLocation }
    },
    targets: [
      {
        id: enemyUnitsPerLocation,
        // "an enemy unit at each location"：对手控制、位于 location 上的单位。
        // perLocation: 1 是 355.11 逐位置分组的占位键（见 judgeReason 第 2 点）；
        // 分组量词落地前不得改写成全局 up-to。
        filter: { type: "unit", controller: "opponent", zone: "board" },
        min: 0,
        max: null,
        selection: "up-to",
        perLocation: 1
      }
    ]
  }
];

const abilities: Ability[] = [
  {
    kind: "static",
    // 142.4.c：改变“足以致死”的伤害数额（规则原文的例子就是本卡）。
    // 作用域：由本卡控制者标记的伤害 vs 敌方单位。
    effect: {
      kind: "continuous.lethal-threshold",
      amount: { kind: "constant", value: 1 },
      appliesTo: { kind: "constant", value: { damageController: "controller", target: "enemy-units" } }
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body
  }
];

export default {
  canonicalCardId:
    "card.hash-f61b6c198fa8246d56a2b3ef18175df62f2d19dcbbfe1b90bd2cd61fa150304b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1)「Any amount of your damage is enough to kill enemy units」（142.4.c：改变致死伤害数额，规则原文的例子就是本卡）" +
    "没有已合入的写入路径：effects/instructions/ 下没有 continuous.lethal-threshold 原语，" +
    "layers 也没有该阈值层的消费方，“由你标记的伤害 vs 敌方单位”的作用域无法注册。" +
    "(2)「choose up to one enemy unit at each location」（355.11 的成组目标）需要逐 location 分组的多目标形状：" +
    "TargetSpec 只有单一 min/max/selection，当前 TargetPlan 只读 filter 与固定的 location 字段，TargetSpec 上的 perLocation 占位键没有消费者（放进 filter 里会被 programs/filters.ts 拒绝），没有“按 location 分组、每组各自 0..1”的量词；" +
    "写成扁平 up-to N 会在同一 location 选两个单位，属近似实现，" +
    "本程序用写明的 perLocation 占位键保留印刷作用域。" +
    "（旧第 3 点“缺 CardProgram → TriggerRegistration 适配器”已撤销：programs/triggers.ts 能注册本卡的 card-played 触发，" +
    "source: self 与 player: controller 也按来源快照解析，golden 已用 production 绑定加真实打出流程验证。）" +
    "body 的 effect.damage（1 点，418.1/418.6.a）已合入并在 golden 中真实执行。不近似实现。",
  abilities,
  sourceText:
    "Any amount of your damage is enough to kill enemy units.\n" +
    "When you play me, choose up to one enemy unit at each location. Deal 1 to them."
} satisfies CardProgram;
