import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Undying Legion (unl-025-219) — Unit, 3 energy, no printed power, Might 3,
 * Fury, tags Spirit/Shadow Isles.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-025-219，逐字）：
 *   [Legion][>] You may play me from your trash for :rb_energy_3::rb_rune_fury:.
 *   (Get the effect if you've played another card this turn.)
 *
 * 规则依据（CR v1.5）：
 * - [Legion]（812.1 / 812.1.a / 812.1.b）：依赖型关键词，格式 “[Legion][>] [Text]”，
 *   从关键词到子句结束整段是 Legion 能力；812.1.b.1 功能上等同 “If you have played another
 *   card this turn, this card gains [Text].”，812.1.c 要求那张牌与本卡不同；812.2 一张牌即可
 *   满足你控制的所有 Legion 实例。关键词只声明（契约 3.7、README 第 5 节），闸门由
 *   effects/keywords/Legion.ts 的展开谓词提供，卡内不重写判定，也不把依赖能力平铺成无条件能力。
 * - [Text] 本体“You may play me from your trash for [3][C].”：默认的合法打出区域是手牌 / 冠军区
 *   （420.1.a），因此这条依赖能力自身提供“从 Trash 打出”的许可（366.1、366.2.a）；费用按
 *   356.1.a 的 “play … for [Cost]” 改写基础费用。可打出与费用改写都由 Finalize 的费用/位置
 *   管线校验（420.3.b.2），因此写成 kind: "play" 的 cost + restriction 声明。
 *   ⚠ 声明的是**替代费用**（356.1.a）：3 Energy + 1 Fury Power 取代印刷的 3 Energy；本卡没有印刷
 *   Power 费用（catalog power: null），这里不把它改写成 0。
 *
 * status = judge-required（复核 2026-10-17）：
 * - Legion 的关键词展开已合入：effects/keywords/Legion.ts 发布 condition.predicate 的
 *   static 谓词（link "active"，history { scope: turn, action: play, player: controller,
 *   excluding: canonicalCardId }）。但该 payload 没有求值方：解释器的 condition.predicate 只求值
 *   随行的 Condition（interpreter.ts 的 "condition.predicate" 分支），不会把 history/excluding 翻成
 *   历史查询；封闭 HistoryQuery 的排除维度是 exclude?: ObjectSelector（按对象排除），不是 812.1.c
 *   的「与本卡不同的一张牌」（按卡身份排除）；也没有 binder 把依赖能力 [Text] 挂到该谓词上。
 * - “play me from your trash”：programs/play.ts 的 translateRestriction 已能把 Requirement/Restriction
 *   转成 Condition 并在 Finalize 校验，但 kind "play-from-zone" 会以 “needs a rules adapter” 被拒
 *   （366.1 的 Trash 许可没有规则适配器），已合入的 cost/ 只消费调用方传入的费用计划，没有
 *   CardProgram → 费用计划的接线；参考内核的 effect.play 需要调用方提供已 Finalize 的费用计划，
 *   不能自行推导。
 * 依赖：condition.predicate/history 的求值、HistoryQuery 的按卡身份排除或等价谓词、
 * 依赖能力正文的绑定；以及区域许可与替代费用 Finalize 接线。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "legion" },
  {
    kind: "play",
    // [Text]：“You may play me from your trash for :rb_energy_3::rb_rune_fury:.”
    // 356.1.a：“for [Cost]” 替换基础费用——3 Energy + 1 Fury Power（本卡域为 Fury）。
    // kind "explicit" 是 CostSpec 的既有显式费用种类（cost/plan-values.ts 接受 activated/explicit），
    // 该组合可由合并费用管线真实支付（golden 覆盖）。
    cost: {
      kind: "explicit",
      energy: { kind: "constant", value: 3 },
      power: { kind: "constant", value: ["Fury"] }
    },
    // 366.1 / 420.1.a：从 Trash 打出需要本能力自身的区域许可。
    restriction: { kind: "play-from-zone", value: { kind: "constant", value: "trash" } },
    // [Text] 的全部内容就是“可以这样打出本卡”，没有额外的结算指令。
    body: []
  }
];

const program = {
  canonicalCardId:
    "card.hash-701096ccbd927a28227b5fb94975bd38a4de82f4f38aa3f6cbe2c6dbc8b1c977",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处缺口：(1) [Legion] 的关键词展开已合入（effects/keywords/Legion.ts），发布带 history { scope: turn, action: play, " +
    "player: controller, excluding: canonicalCardId } 的 condition.predicate 静态谓词，但该 payload 没有求值方：解释器的 " +
    "condition.predicate 只求值随行的 Condition，不把 history/excluding 翻成历史查询；封闭 HistoryQuery 的排除维度是 " +
    "exclude?: ObjectSelector（按对象排除），不是 812.1.c 的按卡身份排除；也没有 binder 把依赖能力 [Text] 挂上谓词。" +
    "(2)「You may play me from your trash for [3][Fury]」需要 366.1 的区域许可适配器与 356.1.a 的替代费用计划接线：" +
    "programs/play.ts 的 translateRestriction 对 kind \"play-from-zone\" 以 “needs a rules adapter” 拒绝；已合入 cost/ " +
    "只消费调用方传入的费用计划，尚无 CardProgram → 费用计划的接线。" +
    "依赖：condition.predicate/history 的求值、按卡身份排除或等价谓词、依赖能力正文绑定，以及区域许可与费用接线。" +
    "本卡不平铺成无条件能力，也不把 Trash 打出近似成手牌打出；golden 只做身份与结构校验。",
  abilities,
  sourceText:
    "[Legion][>] You may play me from your trash for :rb_energy_3::rb_rune_fury:. " +
    "(Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default program;
