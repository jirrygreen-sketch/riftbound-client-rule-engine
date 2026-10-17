import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Dunebreaker (sfd-027-221) — Unit, Fury, The Void.
 * energy 7, power 1 (Fury), Might 7.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-027-221，逐字，含换行）:
 *   "If you have two or fewer cards in your hand, I enter ready.\n"
 *   "When I hold, draw 2."
 *
 * 规则依据（CR v1.5）:
 * - "I enter ready"（359.2.c、369.3 例 Master Yi, Honed）：这是入场替代效果——把单位的
 *   「横置入场」替换为「就绪入场」；effect.ready 文件头明确本原语不参与该流程，不能用
 *   「先横置入场再 effect.ready」近似（805.6.a 同源：不经过先横置再就绪，也不补发
 *   becomes-ready 事件）。因此按契约 3.1 的 replacement 形状表达。
 *   「If you have two or fewer cards in your hand」是替代效果的适用条件（369.3 的
 *   "identified by describing how the unit enters"），写在替代能力自身的 condition 上。
 *   「你」用手牌所有者的 PlayerSelector "self"（190.6.d；chain/engine.ts 的 query 把
 *   owner: "self" 归一化为能力控制者，已合入的 sfd/aspiring-engineer、sfd/here-to-help 同形）。
 * - "When I hold"（383.4.d、383.4.d.2.a）：Hold Effect，时点 hold（scoring/ 发射，
 *   ruleRefs 315.2.b.2/471.2/473.2.b），filter 用内层 source: "self" 指称本卡。
 * - "draw 2"：414.3/414.1.a，缺省抽牌者与来源是能力控制者的 Main Deck 顶；已合入的
 *   effect.draw 只提交封闭的 draw GameAction，牌库顺序与 Burn Out 由内核负责。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - replacement 绑定（RIFT-260，src/replacement/）已合入：自指向 effect.ready 的静态
 *   replaces 体会被识别成入场取向声明，并在 Chain 区永久物换到 Board 前改写取向。
 * - 但这条入场取向路径不求值 ability.condition：replacement/bind.ts 的 matchesEnterAction
 *   在 testCondition 之前就返回 true，所以「If you have two or fewer cards in your hand」
 *   的闸门无法生效（场上的单位一律就绪入场）。条件求值本身也不是本卡的问题：手牌计数用已合入的
 *   count + chain/engine.ts 的 owner/「self」归一化即可；缺的是把 condition 接进入场取向匹配。
 * - hold 触发本身只用已合入时点与 effect.draw，golden 测试对 draw 体做真实执行；
 *   卡牌程序 → TriggerRegistration 的生产接线仍属 RIFT-257。
 * 依赖：RIFT-260 的入场取向条件求值补齐、RIFT-257（触发注册）。不近似实现（不把 enter ready
 * 写成事后 effect.ready，也不把「手牌 ≤ 2」写成常量或干脆删掉）。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { self: true, exhausted: true }
    },
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "objects",
        filter: { zone: "hand", owner: "self" }
      },
      operator: "lte",
      right: { kind: "constant", value: 2 }
    },
    with: [
      {
        id: "dunebreaker.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: { at: "hold", filter: { event: "hold", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "dunebreaker.draw-2",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 2 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-85f0797777f47ae8cbaf1fc45bef08bec2cab5e31a48fa3cff8568018fc7ff8d",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "入场替代已由 RIFT-260 合入（src/replacement/ 把自指向 effect.ready 的 replaces 体识别为入场取向声明，" +
    "在 Chain 区永久物换到 Board 前改写取向），但该路径不求值 ability.condition：replacement/bind.ts 的 " +
    "matchesEnterAction 先于 testCondition 命中，于是「If you have two or fewer cards in your hand」的闸门" +
    "无法生效——手牌 3 张时单位仍以就绪状态入场。条件本身可用已合入的 count + chain/engine.ts 的 owner 归一化" +
    "表达（owner: \"self\"），缺的是入场取向匹配把 condition 纳入判定。" +
    "hold 触发（383.4.d，时点 hold）与 effect.draw 已合入并有执行测试；卡牌程序 → TriggerRegistration 仍属 RIFT-257。" +
    "依赖：RIFT-260 入场取向条件求值、RIFT-257（触发注册）。不近似实现。",
  abilities,
  sourceText:
    "If you have two or fewer cards in your hand, I enter ready.\n" +
    "When I hold, draw 2."
} satisfies CardProgram;

export default program;
