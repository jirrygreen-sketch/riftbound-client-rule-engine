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
 * status 判定（cards/README.md 第 2 节）：judge-required——依赖未合入，均不近似实现：
 * - 仍缺战斗结果发射与战斗死亡载荷：
 *   combat/ 的胜利判定（468.3）没有把 combat-result 交给事件管线（全仓库只有 timing-points.ts 的声明
 *   与 duel/ 的其它流程引用；实测在本包 ChainEngine 上提交战斗相关动作不会发出 combat-result），
 *   object-killed 的 in-combat 判别也没有落地（740.2.c 的战斗身份：
 *   ObjectSnapshot.combatRole 已在契约 3.8 落地，但没有任何时点/载荷把它带到 object-killed，
 *   过滤器的 details.inCombat 也没有消费方）。
 * - "choose an opponent" 缺玩家选择原语（target.player）与该选择结果作为 effect.score 的 player 实参的
 *   已合入链接值形状：effect.score 的 player 接受 PlayerId / PlayerId[] / choose(PlayerId 列表)，
 *   但没有「在所有对手里由控制者重放式选一个玩家」的已注册指令（instructionDefinitionsById.has("target.player") 实测为 false），
 *   因此被选对手无法写进静态 IR；需要原生玩家目标契约。
 * - [Deflect] 的展开（static target.tax）没有消费方：programs/statics.ts 的 layerFor 对该 kind 抛
 *   ProgramBindingError judge-required（实测 "Static ability kind target.tax has no layer mapping"），
 *   TargetPlan 的 TargetTaxAdapter 只接受调用方显式传入的税；chain/engine.ts 的 Finalize 也把收到的税
 *   按 Energy 记账，而不是 809.1.c.1 要求的任意域 Power。
 * - "you score 1 point" 本身只用已合入的 effect.score，golden 对该计分体做真实执行。
 * 仍缺原生玩家目标、战斗结果/战斗死亡载荷，以及目标税图层与 Power 支付绑定。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "triggered",
    trigger: {
      at: "combat-result",
      filter: {
        event: "combat-result",
        // 合并的 translateTriggerFilter 只在有内层 filter/已知锚点时才走
        // EventPattern 分支；裸 details 会被当作对象过滤器并抛
        // "Unsupported filter field details"。空 filter 是已合入的可翻译形状。
        filter: {},
        // 468.3.a / 468.3.c：单位继承控制者的战斗结果，本卡须是胜方单位。
        details: { winnerId: "self" },
        // 383.4.b.1 / 190.6.d：「you score」的 you 是能力控制者。
        player: "self"
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
          // 合并的 self 锚点在 EventPattern 里写作 self: true，由
          // programs/filters.ts 的 translateTriggerFilter 转成宿主 objectId。
          self: true,
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
    "三处缺口（2026-10-18 实测）：" +
    "（1）combat-result 既不在 EVENT_PATTERN_TYPES（实测 invalid-event-type@trigger.filter.event），也没有发射方：" +
    "本包 ChainEngine / combat 上没有把 468.3/468.4 的战斗结果交给事件管线的生产者；" +
    "object-killed 同样拿不到 740.2.c 的 inCombat 载荷（ObjectSnapshot.combatRole 存在，但没有任何时点/载荷把它带到死亡事件，" +
    "details 的 inCombat 无消费方），因此「die in combat」的过滤条件不可满足。" +
    "（2）choose an opponent 缺原生玩家目标及其链接值：instructionDefinitionsById.has(\"target.player\") 实测为 false，" +
    "已注册的 IR 只有对象目标与游戏动作，effect.score 的 choose 形态只接收静态 PlayerId 选项，" +
    "不能在静态卡牌 IR 中列出运行时所有对手；且 chain/engine.ts 发出的事件 player 用链项控制者，不保留 355.18 的实际选择者。" +
    "另外 EventPattern.details 的值只支持标量字面量比较（events/pipeline-match.ts 逐字比对，实测 winnerId:\"self\" 对 " +
    "winnerId:\"A\" 的载荷为 false），\"胜方是能力控制者\" 这类相对玩家判定没有词表；" +
    "本卡的 details 声明同时被 programs/filters.ts 以 \"Unsupported filter field details\" 判负（裸 details 会被当成对象过滤器）。" +
    "（3）Deflect 的展开（static target.tax）没有图层消费方：programs/statics.ts 的 layerFor 对该 kind 抛 " +
    "ProgramBindingError judge-required（实测），TargetPlan 的 taxAdapter 只接受调用方显式传入的税，" +
    "chain/engine.ts 的 Finalize 又把收到的税按 Energy 记账，与 809.1.c.1 的任意域 Power 不符。" +
    "已合入并由 golden 真实执行：effect.score（194.1.c/470.2 的得点）、[Deflect] 关键词声明与对象/玩家 ID 否决分支。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "The first time I win a combat each turn, you score 1 point.\n" +
    "When I die in combat, choose an opponent. They score 1 point."
} satisfies CardProgram;

export default program;
