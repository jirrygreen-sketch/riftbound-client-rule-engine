import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Poppy, Paragon (unl-116-219) — Unit，能量 5，力量未印刷（power: null），Might 5，
 * 领域 Body，标签 Yordle/Demacia/Poppy/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-116-219，逐字）:
 *   "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
 *   "When you play me, if an opponent's score is within 3 points of the Victory Score, " +
 *   "ready me and gain 3 XP."
 *
 * 规则依据（CR v1.5）:
 * - [Deflect]：809.1.a（永久物上的被动能力关键词）、809.1.b.3（省略数值按 1）、
 *   809.1.c / 809.1.c.1（对手的咒语/能力选择我时追加可用任意域支付的 Power）、
 *   809.2（数值相加）、809.3（可引用特征）。卡文件只声明关键词（契约 3.1/3.7）。
 * - "When you play me"：383.4.a / 383.4.a.1 的 Play Effect（420.4.a 在打出完成后触发），
 *   封闭时点 card-played，filter 指向本源自身。
 * - "if an opponent's score is within 3 points of the Victory Score"：383.2.a.1 规定紧跟
 *   触发条件的 if 从句属于触发条件本身，在触发时求值；194.3 的 Victory Score 默认 8、
 *   194.3.a 允许游戏模式或卡牌效果改变它（485.3.a：可以是任意正数），因此不能硬编码 8。
 *   当前取值路径缺两段，条件用 never 显式 fail closed（见 judgeReason 第 2 条）。
 * - "ready me"：416.1 / 416.1.a 的重置动作；"me" 是能力来源自身（355.10.g），用已合入的
 *   effect.ready 的缺省 source 选择（不写死引用）。
 * - "gain 3 XP"：728 / 730.1，用已合入的 effect.xp；获得者缺省为能力控制者（190.6.d）。
 * - "ready me and gain 3 XP" 是同一效果里的两个并列指令（055 / 359.3.e.11：能做什么做什么），
 *   互不引用，因此两条指令都不写 linkedTo。
 *
 * 2026-10-18 复核：仍为 judge-required，当前缺口见 judgeReason。
 * 已有原语、关键词定义或通用适配器不代表本卡完整生产路径可执行。
 */
const body: readonly Instruction[] = [
  {
    // "ready me"：effect.ready 的缺省选择就是能力来源自身（355.10.g、412.4）。
    id: "poppy-paragon.ready-self",
    op: "effect.ready",
    args: { objects: { kind: "constant", value: { kind: "source" } } }
  },
  {
    // "gain 3 XP"：独立的一句，不链接前一条（359.3.e.14 只链接被引用的指令）。
    id: "poppy-paragon.gain-3-xp",
    op: "effect.xp",
    args: { amount: { kind: "constant", value: 3 } }
  }
];

const abilities: Ability[] = [
  // 809：Deflect 不写数值（809.1.b.3 省略即 1，展开由关键词注册表负责）。
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "controller" } },
      // 383.2.a.1：紧跟触发条件的 if 从句属于触发条件，在触发时求值。
      // “对手分数在胜利分数 3 分以内”还没有可求值路径：Expr 的 player-property 只能读
      // 各自 score、没有 victoryScore（engine-core/src/effects/contract.ts 的 PlayerSnapshot），
      // TurnFlow.victoryScore 也没有接进 ResolveContext。命名的谓词保留印刷条件形状，但
      // expression 条件把非空字符串当真，所以整体用 never 显式 fail closed（不硬编码 8）。
      condition: {
        kind: "all",
        conditions: [
          { kind: "never" },
          {
            kind: "expression",
            value: { kind: "constant", value: "opponent-score-within-3-of-victory-score" }
          }
        ]
      }
    },
    optional: false,
    body
  }
];

export default {
  canonicalCardId:
    "card.hash-f5361ea4d4f46808730ef47f9575d7fc51b16c6cbcfb2659bca74cdd30b9baf2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Deflect 的 target.tax 静态绑定及 Chain Finalize 接线（809.1.c.1）：target/tax 已能从当前关键词或 BoundTargetTax 计算任意域 Power，" +
    "但 programs/statics.ts 不映射 target.tax，chain/engine.ts 仍覆盖该适配器并将税额按 Energy 记账。" +
    "缺触发条件所需的当前 Victory Score 读取（194.3/194.3.a/485.3.a）：ResolveContext/PlayerSnapshot 只有各自 score，" +
    "Expr 的 player-property 也没有 victoryScore，TurnFlow.victoryScore 未接进 ResolveContext。" +
    "本卡命名谓词只是保留形状，表达式解释器会把非空字符串当作真（实测），因此条件整体用 never 显式阻断，" +
    "既不能作为条件执行证据，也不能硬编码胜利分数 8。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When you play me, if an opponent's score is within 3 points of the Victory Score, " +
    "ready me and gain 3 XP."
} satisfies CardProgram;
