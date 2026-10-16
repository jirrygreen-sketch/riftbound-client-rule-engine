import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Scuttle Crab (unl-053-219) — Unit, 2 Energy、无印刷力量值，Might 0，Calm，
 * tag Bilgewater。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-053-219，逐字，含换行）：
 *   (Units with 0 :rb_might: can conquer and hold.)
 *   When you play me, draw 1.
 *   [Deathknell][>] Choose an opponent. They reveal their hand. You can look at
 *   their facedown cards this turn. Gain 1 XP. (When I die, get the effects.)
 *
 * 规则依据（CR v1.5）：
 * - 第一行是提醒文字（135.2.d.1/d.3）：0 Might 单位可以征服与固守是通则结果
 *   （470 的 Scoring 不要求 Might），不是本卡的独立能力，不写成指令。数据里 Might 为 0
 *   （不是 null、也不是省略），本程序不读取或改写该值。
 * - 383.4.a / 383.4.a.1："When you play me, draw 1." 是 Play Effect（时点 card-played，
 *   自身），body 是已合入的 effect.draw（414.1/414.3，抽牌者按 190.6.d 隐含为能力控制者）。
 * - 808 / 808.1.c："[Deathknell][>] …" 是触发式能力关键词，功能上等价于
 *   "When I die, [Effect]"；触发条件是载体被消灭并送入 Trash（429.1，时点 object-killed），
 *   括号内 "(When I die, get the effects.)" 是提醒文字。关键词展开归
 *   effects/keywords/Deathknell.ts，卡牌只声明 keyword 并显式写出印刷的 [Effect] 正文
 *   （ogn/watchful-sentry 同型）。
 * - 355.7 / 355.9.a："Choose an opponent" 指名一个 Player，属选目标；合并 IR 的
 *   TargetSpec.filter 是 ObjectFilter、ResolveContext.targets() 只返回 ObjectRef[]，
 *   没有玩家目标形态（ogn/mindsplitter、ogn/sabotage 记录同一缺口）。
 * - 425.1 / 425.2.a / 425.3.a："They reveal their hand" 是 Reveal 动作（未指明张数时
 *   展示该区域当时的全部牌），由已合入的 effect.reveal 执行；"their facedown cards"
 *   是同一玩家在 Facedown Zone 的牌（107.3.a/107.3.f、355.9.a.3），
 *   "You can look at" 是私下查看（128.4），由已合入的 effect.inspect 执行。
 * - 728 / 730.1："Gain 1 XP" 是玩家 XP 资源增加，由已合入的 effect.xp 执行
 *   （823.1.c.1 的 Hunt 同型写法）。
 *
 * status = judge-required（缺口不近似实现）：
 * - "Choose an opponent" 没有玩家目标/玩家选择形态：TargetSpec.filter 是 ObjectFilter，
 *   ResolveContext.targets() 只返回 ObjectRef[]，ChoiceRequest 只有 optional/mode/
 *   select-objects/order/number（没有选择玩家的请求类型），也没有把选择结果作为后续
 *   effect.reveal / effect.inspect 的 player 实参的链接绑定。程序保留
 *   target.player 声明与 "opponent" 占位（ogn/mindsplitter 同型）。
 * - "You can look at their facedown cards this turn" 需要（a）Facedown Zone 的读取入口：
 *   合并的 ZoneId 只有 hand/deck/rune-deck/trash/banishment/board/rune-zone/chain，
 *   没有 Facedown Zone（107.3.a），ObjectSnapshot.faceDown 只能判断状态、不能按区域查询；
 *   （b）“this turn” 的查看期限（425.1.a.3 的 Revealed/looked 状态期限）没有期限字段。
 * - [Deathknell] 展开体（effects/keywords/Deathknell.ts）只引用未注册的 trigger.leave，
 *   且链/事件管线尚未把卡程序触发注册进管线（RIFT-82 / RIFT-120）。
 * golden 对已合入部分（effect.draw、effect.reveal、effect.xp）用解释器 + 参考内核真实执行，
 * 玩家参数由调用方按最终锁定的对手传入。
 *
 * 依赖：玩家目标/玩家选择（target.player）与其链接绑定、Facedown Zone 的查询与查看期限、
 * RIFT-82（kw-deathknell 的 trigger.leave）、RIFT-120（触发注册）。
 */

const abilities: Ability[] = [
  // 808.1：印刷的 [Deathknell] 声明；展开由 effects/keywords/Deathknell.ts 负责。
  { kind: "keyword", keyword: "deathknell" },
  {
    // 383.4.a："When you play me" 的 Play Effect。
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "scuttle-crab.draw-one",
        // 414.1/414.3："draw 1"，抽牌者缺省为能力控制者（190.6.d）。
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  },
  {
    // 808.1.c："When I die, [Effect]." 的印刷效果正文；触发条件是载体被消灭
    // （429.1，时点 object-killed；808.1.d.2/.d.3 的进链与最后已知信息归触发管线）。
    kind: "triggered",
    trigger: { at: "object-killed", filter: { self: true, cause: "kill", destination: "trash" } },
    optional: false,
    body: [
      {
        id: "scuttle-crab.choose-opponent",
        // 355.7 / 355.9.a："Choose an opponent" 是玩家目标；合并 IR 没有玩家目标形态
        // （见 judgeReason），此处按 ogn/mindsplitter 的 target.player 声明保留形状。
        op: "target.player",
        args: {
          selection: { kind: "constant", value: "one" },
          chooser: { kind: "constant", value: "controller" },
          linkKey: { kind: "constant", value: "chosenOpponent" }
        }
      },
      {
        id: "scuttle-crab.reveal-hand",
        // 425.3.a：未指明张数时展示该区域当时的全部牌；reveal 不改变区域（425.1.a.2）。
        op: "effect.reveal",
        linkedTo: "scuttle-crab.choose-opponent",
        args: {
          // "They" = 被选中的对手；玩家绑定本身是缺口（见 judgeReason），
          // 这里用同一条指令的链接值记录该占位，不写死座位。
          player: {
            kind: "linked-value",
            instructionId: "scuttle-crab.choose-opponent",
            key: "chosenOpponent"
          },
          zone: { kind: "constant", value: "hand" }
        }
      },
      {
        id: "scuttle-crab.look-facedown-cards",
        // 128.4 / 107.3.f："You can look at their facedown cards" 是私下查看该对手
        // 的面朝下牌。合并 ZoneId 没有 Facedown Zone（107.3.a），也没有 "this turn"
        // 的查看期限（425.1.a.3），故 zone 值只是待接线的描述性标记（见 judgeReason）。
        op: "effect.inspect",
        linkedTo: "scuttle-crab.choose-opponent",
        args: {
          player: { kind: "constant", value: "self" },
          zone: { kind: "constant", value: "facedown-zone" },
          scope: { kind: "constant", value: "zone" }
        }
      },
      {
        id: "scuttle-crab.gain-xp",
        // 730.1 / 733："Gain 1 XP"，获得者按 190.6.d 隐含为能力控制者；
        // XP 不是 Game Object（731），因此不写 target。
        op: "effect.xp",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-91762c9845d59867fb973e9ccacb4f75c8ba2a8d294513c8512d195dc2690d51",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：（1）『Choose an opponent』是玩家目标（355.7/355.9.a），" +
    "但合并 IR 没有玩家目标形态：TargetSpec.filter 是 ObjectFilter、ResolveContext.targets() 只返回 ObjectRef[]，" +
    "ChoiceRequest 也只有 optional/mode/select-objects/order/number（没有选择玩家的请求类型），" +
    "且没有把选择结果绑定为后续 effect.reveal / effect.inspect 的 player 实参的链接通道；程序按 target.player + " +
    "『opponent』占位保留形状。" +
    "（2）『You can look at their facedown cards this turn』需要 Facedown Zone：合并 ZoneId 只有 " +
    "hand/deck/rune-deck/trash/banishment/board/rune-zone/chain，没有 107.3.a 的 Facedown Zone，" +
    "ObjectSnapshot.faceDown 只能判断状态、不能按区域查询；『this turn』的查看期限（425.1.a.3）也没有期限字段。" +
    "（3）[Deathknell]（808）的展开体只引用未注册的 trigger.leave op，且链/事件管线尚未把卡程序触发注册进管线。" +
    "依赖：玩家目标/玩家选择（target.player）及其链接绑定、Facedown Zone 查询与查看期限、RIFT-82（kw-deathknell）、" +
    "RIFT-120（触发注册）。effect.draw / effect.reveal / effect.xp 本体已合入，golden 对它们做真实执行。",
  abilities,
  sourceText:
    "(Units with 0 :rb_might: can conquer and hold.)\n" +
    "When you play me, draw 1.\n" +
    "[Deathknell][>] Choose an opponent. They reveal their hand. You can look at their facedown cards this turn. " +
    "Gain 1 XP. (When I die, get the effects.)"
} satisfies CardProgram;
