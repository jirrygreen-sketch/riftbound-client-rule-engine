import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Disciple of Shen (ven-117-166) — Unit, 2 Energy, Might 1, Order, tag Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-117-166，逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   I have [Shield 3] while I'm at a battlefield with exactly one other unit
 *   you control. (+3 :rb_might: while I'm a defender.)
 *
 * 规则依据（CR v1.5）：
 * - 811.1 / 811.1.a–c：Hidden 是执行 Hide 自由行动的关键词前置；811.1.b 的功能等价文本
 *   是「只要此牌在你手牌或你的 Champion Zone，你可以支付 [A] 把它面朝下藏起来」。
 *   按契约 3.7 与 README 第 5 节只声明 { kind: "keyword", keyword: "hidden" }，展开由
 *   effects/keywords/Hidden.ts 负责（该文件的依赖缺口见 judgeReason）。
 * - 814.1 / 814.1.b.2 / 814.1.b.3 / 814.1.c：[Shield 3] 是把印刷数值 3 的 Shield 授予
 *   宿主自身（省略数值时按 1，本卡写明 3）；814.1.c 的功能等价文本为「当我是防守者时
 *   +X [M]」，804/814.1.d 的 Defender designation 与可能的 +3 Might 修正都不由卡程序
 *   重写。
 * - 「while I'm at a battlefield with exactly one other unit you control」是授予 Shield 3
 *   的门控条件：同地点（sameLocationAs 宿主，359.3.f）、控制者为你的其它单位恰好 1 个
 *   （355.9.c 的 "other" 排除来源自身），用 count + exclude: "self" 表达，写作 static
 *   ability 的 condition（契约 3.4：条件只作用于所属能力）。
 *
 * status = judge-required（两处缺口，均不近似实现）：
 * 1. [Hidden] 的 KeywordDef 已合入，但没有结算消费方：Hidden.ts 自身记录 cost.hidden /
 *    cost.pay / effect.zone 未合入（其头部引用 RIFT-89），cost/README.md 第 3 条也明确
 *    zones/actions 尚不支持 Facedown Zone 与 Hide；cost.hidden 同时没有 layerFor 映射，
 *    绑定会抛 ProgramBindingError 并被 attachLifecycle 的 onError 吞掉（fail-closed）。
 *    811.1.d/811.5 的藏牌、811.6 的后续 [Reaction] 与 0 能量打出都无执行路径。
 * 2. 条件授予侧不可执行：静态效果注册入口已合入（bindStaticToLayers /
 *    attachLifecycle），但本卡条件里的 controller：“controller” 选择符在
 *    layers/filter.ts 的 selectorMatches 中不被解析（只会做字面字符串比较），生产路径
 *    里计数恒为 0、条件恒假（RIFT-359）。「exactly one other unit you control here」
 *    无法被诚实求值。下方的 condition.predicate golden 只证明条件 IR 形状可由解释器
 *    求值；它能通过，是因为测试内核的玩家 id 字面叫 "controller"，并不代表生产链路。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "static",
    effect: {
      // 814.1.b.2/814.1.b.3：印刷值 3；814.1.c 展开为「作为防守者时 +3 [M]」，
      // 由 effects/keywords/Shield.ts 与 layers 负责，卡程序不重写。
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keywords: [{ id: "shield", value: 3 }]
    },
    // 「while I'm at a battlefield with exactly one other unit you control」
    condition: {
      kind: "compare",
      left: {
        kind: "count",
        subject: "other-friendly-units-here",
        filter: {
          type: "unit",
          zone: "board",
          controller: "controller",
          sameLocationAs: "self",
          exclude: "self"
        }
      },
      operator: "eq",
      right: { kind: "constant", value: 1 }
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-29466276a36ad6d31ede84a0b5f6d73cfe73590d866accc1e138b05ffecd77ca",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) [Hidden] 的 KeywordDef 已合入（effects/keywords/Hidden.ts，811.1）但没有结算消费方——" +
    "该文件自述 cost.hidden / cost.pay / effect.zone 未合入（其头部引用 RIFT-89），cost/README.md 第 3 条明确 " +
    "zones/actions 尚不支持 Facedown Zone 与 Hide，且 cost.hidden 无 layerFor 映射，绑定抛 ProgramBindingError " +
    "被 attachLifecycle 的 onError 吞掉；811.1.d/811.5 的藏牌、811.6 的后续 [Reaction] 与 " +
    "0 能量打出都无执行路径。(2) 「I have [Shield 3] while I'm at a battlefield with exactly one " +
    "other unit you control」的授予侧不可执行：continuous.grant-keyword 静态效果有注册入口（bindStaticToLayers / " +
    "attachLifecycle）已合入，但 " +
    "condition.filter 的 controller：“controller” 选择符在 layers/filter.ts 的 selectorMatches 中不被解析，" +
    "生产路径里计数恒 0、条件恒假——814.1.c 的“恰好一个其它友方单位在此”无法被诚实求值（RIFT-359）。" +
    "依赖：RIFT-89（Hidden 的 Hide 路径与费用）、RIFT-359（条件谓词）。golden 中的 condition.predicate " +
    "只覆盖解释器路径，且测试内核的玩家 id 恰好字面叫 “controller”。", 
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "I have [Shield 3] while I'm at a battlefield with exactly one other unit you control. " +
    "(+3 :rb_might: while I'm a defender.)"
} satisfies CardProgram;
