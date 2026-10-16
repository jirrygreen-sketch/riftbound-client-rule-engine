import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Draven, Audacious (sfd-148-221) — Unit, Chaos, Draven/Noxus/Champion.
 * energy 6, power 1, Might 6.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-148-221，逐字，含换行）:
 *   "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n"
 *   "The first time I win a combat each turn, you score 1 point.\n"
 *   "When I die in combat, choose an opponent. They score 1 point."
 *
 * 规则依据（CR v1.5）：
 * - [Deflect]（809.1）：被动关键词；809.1.b.3 规定省略数值时 X 为 1，故 keyword 不带 value，
 *   展开（static target.tax）由已合入的 effects/keywords/Deflect.ts 负责，卡牌不重写。
 * - "The first time I win a combat each turn"：468.3.a 定义「玩家赢得战斗」（取得攻击者或防守者身份
 *   且是该战场唯一仍留有单位的玩家），468.3.c 规定单位继承其控制者的战斗结果。"The first time … each turn"
 *   是 383.3.e / 383.3.e.1 的每回合一次触发寿命，TriggerSpec 用 once: "per-turn"（与已合入
 *   ogn/the-dreaming-tree 同型）。时点用封闭枚举的 combat-result（events/timing-points.ts，
 *   payloadFields 含 combatId/battlefieldId/winnerId/loserId/unitResults/noResult，ruleRefs 468.3.a–468.4）。
 * - "you score 1 point"：194.1.c 的效果得点，
 *   effect.score（470.1–470.3；470.1 明确 Gaining Points 与 Scoring a Battlefield 是两回事），
 *   缺省得点者是能力控制者（190.6.d 的 "you"），故不写 player 参数。
 * - "When I die in combat"：单位在战斗中死亡。808.1.d 把"触发于来源死亡"的触发定义在 Permanent 被 Kill
 *   并送入 Trash 上（808.1.d.2 在换区前作为 Pending Item 进链、808.1.d.3 在换区前记录其位置与特征），
 *   时点用 object-killed（ruleRefs 429.1/808.1.d）。"in combat" 是死亡时的状态限制（740.2.c）。
 * - "choose an opponent. They score 1 point."：355.9.a 允许把 Player 作为选择对象；
 *   按调研表 target.player 行（"each player 与 choose opponent 不等价"），玩家选择需要独立原语
 *   target.player/full player-target 形态；已合入的 IR 只有对象目标与游戏动作，没有玩家目标声明
 *   （同 ogn/mindsplitter、ogn/sabotage 记录）。"They score 1 point" 是给该被选对手的 effect.score。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required——三处依赖未合入，均不近似实现：
 * - 两个时点都没有发射方，且没有把 CardProgram 的 triggered ability 注册为 TriggerRegistration 的接线：
 *   combat/ 的胜利判定（468.3）没有把 combat-result 交给事件管线（全仓库只有 timing-points.ts 的声明
 *   与 duel/ 的其它流程引用），object-killed 的 in-combat 判别也没有落地（740.2.c 的战斗身份）。
 * - "choose an opponent" 缺玩家选择原语（target.player）与该选择结果作为 effect.score 的 player 实参的
 *   链接值形状；已合入的 effect.score 的 player 选择符只接受 target(对象)/pick/choose(字符串列表)，
 *   没有把被选对手直接写进去的静态形态。
 * - [Deflect] 的展开（static target.tax）没有消费方：TargetPlan 的 TargetTaxAdapter 只接受调用方显式传入的税，
 *   没有从图层读取 target.tax 的接线，且已合入的税→费用换算按 Energy 记账，与 809.1.c.1 的
 *   "任意域 Power"不符（RIFT-90）。
 * - "you score 1 point" 本身只用已合入的 effect.score，golden 对该计分体做真实执行。
 * 依赖：RIFT-90（目标税与玩家目标/选择）、RIFT-120（combat-result 与 object-killed 的时点发射、
 * 卡牌触发注册）、战斗身份特征（contract 3.8 的 combatRole）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "triggered",
    trigger: {
      at: "combat-result",
      filter: {
        event: "combat-result",
        // 468.3.a / 468.3.c：单位继承控制者的战斗结果，本卡须是胜方单位。
        details: { winnerId: "self" },
        player: "controller"
      },
      // 383.3.e / 383.3.e.1："The first time … each turn" 的每回合一次寿命。
      once: "per-turn"
    },
    optional: false,
    body: [
      {
        // 194.1.c / 470.2："you score 1 point" = 效果得点，缺省得点者是能力控制者。
        id: "draven-audacious.score-on-win",
        op: "effect.score",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: {
        event: "object-killed",
        // 808.1.d / 808.1.d.2：触发于自身被消灭（在换区前作为 Pending Item 进链）。
        filter: { object: "self" },
        // 740.2.c 的 "in combat"：死亡时的战斗身份限制。
        details: { inCombat: true }
      }
    },
    optional: false,
    body: [
      {
        // 355.9.a / "choose an opponent"：玩家选择（target.player 形态未合入，见 judgeReason）。
        id: "draven-audacious.choose-opponent",
        op: "target.player",
        args: {
          selection: { kind: "constant", value: "one" },
          chooser: { kind: "constant", value: "controller" },
          scope: { kind: "constant", value: "opponent" },
          linkKey: { kind: "constant", value: "chosenOpponent" }
        }
      },
      {
        // "They score 1 point"：由被选对手得点（388 / 470.2 的 Gaining Points）。
        id: "draven-audacious.opponent-scores",
        op: "effect.score",
        linkedTo: "draven-audacious.choose-opponent",
        args: {
          amount: { kind: "constant", value: 1 },
          player: {
            kind: "linked-value",
            instructionId: "draven-audacious.choose-opponent",
            key: "chosenOpponent"
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-517bab9d87b5b339d5d8886b24a11340875d925af78a9616dcb0a621e6ea4818",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "(1) combat-result（468.3，由 combat/ 判定）与 object-killed 的「在战斗中」判别都没有发射方/消费方：" +
    "全仓库只有 timing-points.ts 声明 combat-result，combat/ 的胜利判定没有把该时点交给事件管线，" +
    "740.2.c 的战斗身份（契约 3.8 规划的 ObjectSnapshot.combatRole）也未进入 engine-core 的 effects/contract.ts；" +
    "同时没有把 CardProgram 的 triggered ability 注册为 TriggerRegistration 的接线（RIFT-120）。" +
    "(2)「choose an opponent」缺玩家选择原语（target.player；调研表 target.player 行记录「each player 与 choose opponent 不等价」），" +
    "也没有把该选择结果作为 effect.score 的 player 实参的已合入链接形状（effect.score 的 player 选择符只接受对象 target / pick / choose 字符串列表）。" +
    "(3) [Deflect]（809.1）的展开（static target.tax）没有消费方：TargetPlan 的 TargetTaxAdapter 只接受调用方显式传入的税，" +
    "没有从图层读取 target.tax 的接线，且已合入的 tax→费用换算按 Energy 记账，与 809.1.c.1 要求的任意域 Power 不符（RIFT-90）。" +
    "「you score 1 point」只用已合入的 effect.score（470.1–470.3），golden 对该计分体做真实执行。" +
    "依赖：RIFT-90、RIFT-120、战斗身份特征（契约 3.8 combatRole）。不近似实现。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "The first time I win a combat each turn, you score 1 point.\n" +
    "When I die in combat, choose an opponent. They score 1 point."
} satisfies CardProgram;

export default program;
