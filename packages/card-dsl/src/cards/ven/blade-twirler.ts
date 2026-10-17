import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Blade Twirler (ven-002-166) — Unit, Fury, tags Yordle / Ionia.
 * energy 4, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-002-166，逐字）：
 *   The first time I move each turn, choose a player. They [Burn 1]. (They put the
 *   top card of their Main Deck into their trash.)
 *
 * 规则依据（Core Rules v1.5）：
 * - 421.1 / 449.1 / 449.2：一次成功完成的 Move 对应封闭时点 object-moved（events/
 *   timing-points.ts 的 movement 载荷）；“I move” 用 filter 指向本卡自身。458.1 的
 *   Recall 不算 Move，因此不能用别的时点替代。
 * - 383.2.a：“The first time … each turn” 是触发条件的一部分；契约 3.5 的
 *   TriggerSpec 用 once: "per-turn" 表达该寿命（与 sfd-113-221 Lucian, Merciless
 *   同一写法）。
 * - 441.1 / 441.2 / 441.2.a：Burning 就是把一名玩家主牌库顶的牌移入其弃牌区，
 *   格式为 “Burn X.”；括号里是提醒文本。441.4：作为效果的一部分必须尽可能多烧，
 *   牌库不足只烧得到的部分并交给内核处理 Burn Out（432）。
 * - 355.9.a / 355.10.f：被选择的是**玩家**而不是游戏对象；“choose a player” 属
 *   结算期选择，不是对象目标。
 * - 190.6.d：该 “They” 指被选中的玩家，烧牌者就是那个玩家本人。
 *
 * status = judge-required（三处缺口均不近似实现）：
 * 1. 缺玩家选择原语 target.player：契约 3.6 的 TargetSpec 只描述对象过滤器，
 *    PickSpec.options 是静态值数组，targets() 返回 ObjectRef、picks() 才可能返回
 *    PlayerId；ability-templates 第 4 节的 target.player 行明确 “each player 与
 *    choose opponent 不等价”。本程序按该形状写出指令，但它没有实现文件。
 * 2. 卡牌触发进入引擎的注册通道（programs/triggers.ts 的 registerProgramTriggers，
 *    RIFT-120）已合入：move-location 事件也已带 fromZone/toZone。但 target.player
 *    仍缺实现文件，玩家选择结果 → effect.mill 的 player 参数消费也没有已合入路径
 *    （链接值形状待定），所以即使选择落地也接不进烧牌步。
 * 依赖：target.player 原语与玩家选择接线。
 * 已支持部分：effect.mill 本体（441.1/441.2/441.4）已合入，golden 用真实解释器 + 参考
 * 内核执行该烧牌步（直接绑定被选玩家，不伪造选择）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } },
      // “The first time I move each turn”：383.2.a 的触发条件寿命。
      once: "per-turn"
    },
    optional: false,
    body: [
      {
        id: "blade-twirler.choose-player",
        // 355.9.a/355.10.f 的玩家选择需要 target.player 原语（ability-templates 第 4 节）；
        // effects/instructions/ 下没有该文件，本指令当前无法执行，也不能用 effect.discard
        // 或对象目标近似。
        op: "target.player",
        args: {
          selection: { kind: "constant", value: "one" },
          chooser: { kind: "constant", value: "controller" },
          linkKey: { kind: "constant", value: "chosenPlayer" }
        }
      },
      {
        id: "blade-twirler.burn-1",
        op: "effect.mill",
        linkedTo: "blade-twirler.choose-player",
        args: {
          // 441.2.a：Burn 1 的牌数是印刷常量 1。
          amount: { kind: "constant", value: 1 },
          // 190.6.d 的 “They” = 被选中的玩家：本应先由 target.player 写入链接值，
          // 再经该表达式读取；目标玩家选择未合入，故该参数当前不可用。
          player: {
            kind: "linked-value",
            instructionId: "blade-twirler.choose-player",
            key: "chosenPlayer"
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-cb21758ecfca99ee0664cb303df5b4bcaf610c851720b908072b2555e533474b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) 缺玩家选择原语 target.player——契约 3.6 的 TargetSpec 只描述对象过滤器，PickSpec.options 是静态值数组，" +
    "targets()/picks() 的对象形状承载不了「在所有玩家中选一个」的重放式选择（ability-templates 第 4 节 target.player 行：" +
    "each player 与 choose opponent 不等价），程序里声明的 target.player 在 effects/instructions/ 没有实现文件；" +
    "(2) 卡牌触发进入引擎的注册通道（programs/triggers.ts 的 registerProgramTriggers，RIFT-120）已合入，" +
    "move-location 事件也已带 fromZone/toZone；(3) 没有已合入路径把玩家选择结果作为 effect.mill 的 player 参数消费" +
    "（链接值形状待定），所以即使选择落地也接不进烧牌步。" +
    "已支持部分：effect.mill 本体（441.1/441.2/441.4 的 Burn 1）由 golden 用真实解释器 + 参考内核执行，" +
    "绑定被选玩家而不伪造选择。依赖 target.player 原语与玩家选择接线。不近似实现。",
  abilities,
  sourceText:
    "The first time I move each turn, choose a player. They [Burn 1]. (They put the top card of their " +
    "Main Deck into their trash.)"
} satisfies CardProgram;
