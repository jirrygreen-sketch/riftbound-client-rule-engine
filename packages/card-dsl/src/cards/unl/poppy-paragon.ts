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
 * - "ready me"：416.1 / 416.1.a 的重置动作；"me" 是能力来源自身（355.10.g），用已合入的
 *   effect.ready 的缺省 source 选择（不写死引用）。
 * - "gain 3 XP"：728 / 730.1，用已合入的 effect.xp；获得者缺省为能力控制者（190.6.d）。
 * - "ready me and gain 3 XP" 是同一效果里的两个并列指令（055 / 359.3.e.11：能做什么做什么），
 *   互不引用，因此两条指令都不写 linkedTo。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。CardProgram → TriggerRegistration
 * 适配器、effect.ready / effect.xp 均已合入。
 *
 * 仍缺两处（不近似实现）：
 * 1. [Deflect] 的展开文件（effects/keywords/Deflect.ts）已合入，但没有生产方把永久物的
 *    target.tax 持续效果接进目标选择与费用计划（target/target-plan.ts 只在调用方显式传入
 *    tax 时追加，链的 Finalize 不读图层；layers/rules/query.ts 也没有读取 target.tax 的
 *    查询），且已合入的税→费用换算按 Energy 记账，而 809.1.c.1 要求任意域的 Power
 *    （同 sfd/navori-scout）。
 * 2. 触发条件的求值需要当前 Victory Score（194.3/194.3.a）：ResolveContext 只暴露各自
 *    score（PlayerSnapshot.score），没有 victoryScore 读数，硬编码 8 就是臆造。
 * body 的 ready 与 gain 3 XP 已合入（effect.ready / effect.xp），golden 用解释器 + 参考内核
 * 真实执行，并覆盖已经就绪时的无操作（416.1.b/416.1.c）。
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
      // 383.2.a.1：紧跟触发条件的 if 从句属于触发条件，在触发时求值；
      // “对手分数在胜利分数 3 分以内”需要 Victory Score 读数，用命名的谓词记录
      // 印刷条件（不硬编码 8，见 judgeReason 第 2 点）。
      condition: {
        kind: "expression",
        value: { kind: "constant", value: "opponent-score-within-3-of-victory-score" }
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
    "卡牌程序绑定、effect.ready（416.1）与 effect.xp（730.1）已合入并在 golden 中真实执行；" +
    "仍有两处缺口，均不近似实现：(1) [Deflect] 的展开文件已合入，但没有生产方把永久物的 target.tax 持续效果接进目标选择与费用计划" +
    "（target/target-plan.ts 只在调用方显式传入 tax 时追加，链的 Finalize 不读图层，layers/rules/query.ts 也没有 target.tax 查询），" +
    "且已合入的税→费用换算按 Energy 记账，809.1.c.1 要求可用任意域支付的 Power（同 sfd/navori-scout）。" +
    "(2) 触发条件「an opponent's score is within 3 points of the Victory Score」需要当前 Victory Score" +
    "（194.3 默认 8、194.3.a 允许被游戏模式或卡牌效果改变；485.3.a 可为任意正数）：ResolveContext/PlayerSnapshot 只有各自 score，" +
    "没有 victoryScore 读数，硬编码 8 就是臆造，因此本程序用命名谓词保留条件而不求值。" +
    "两条正文指令是并列句，不写 linkedTo（359.3.e.11）。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When you play me, if an opponent's score is within 3 points of the Victory Score, " +
    "ready me and gain 3 XP."
} satisfies CardProgram;
