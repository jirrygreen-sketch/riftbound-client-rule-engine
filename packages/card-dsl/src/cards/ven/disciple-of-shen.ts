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
 * 1. [Hidden] 的 KeywordDef 已合入，但没有消费方：Hidden.ts 自身记录 cost.hidden /
 *    cost.pay / effect.zone / continuous.timing 均未合入，cost/README.md 第 3 条也明确
 *    zones/actions 尚不支持 Facedown Zone 与 Hide，811.1.d/811.5 的藏牌、811.6 的后续
 *    [Reaction] 与 0 能量打出都无执行路径（RIFT-89）。
 * 2. 条件授予侧不可执行：卡牌侧没有注册 continuous.grant-keyword / continuous.might
 *    静态效果的入口（ctx.addContinuous 只有 chain/engine 内部接线），且 layers/engine.ts
 *    的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，compare/count
 *    一律返回 true——「exactly one other unit you control here」无法被诚实求值
 *    （RIFT-91 的 layers 引擎已合入求值骨架，条件谓词与卡牌注册路径未接通）。
 * 条件形状本身用已合入的 condition.predicate 在 golden 中真实求值（恰好 1 个为真、0 个
 * 与 2 个为假、异地的友方单位不计入）。
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
    "两处缺口，均不近似实现：(1) [Hidden] 的 KeywordDef 已合入（effects/keywords/Hidden.ts，811.1）但没有消费方——" +
    "该文件自述 cost.hidden / cost.pay / effect.zone / continuous.timing 均未合入，cost/README.md 第 3 条明确 " +
    "zones/actions 尚不支持 Facedown Zone 与 Hide，811.1.d/811.5 的藏牌、811.6 的后续 [Reaction] 与 " +
    "0 能量打出都无执行路径（RIFT-89）。(2) 「I have [Shield 3] while I'm at a battlefield with exactly one " +
    "other unit you control」的授予侧不可执行：卡牌侧没有注册 continuous.grant-keyword / continuous.might 静态效果的" +
    "入口（ctx.addContinuous 只有 chain/engine 内部接线），且 layers/engine.ts 的 conditionMatches 只识别 " +
    "always/never/type/has-tag/has-keyword，compare/count 一律返回 true——814.1.c 的“恰好一个其它友方单位在此”" +
    "无法被诚实求值（RIFT-91 只合入了图层求值骨架）。依赖：RIFT-89（Hidden 的 Hide 路径与费用）、" +
    "RIFT-91 后续（图层条件谓词与卡牌持续效果注册）。条件形状本身用已合入的 condition.predicate 真实求值。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "I have [Shield 3] while I'm at a battlefield with exactly one other unit you control. " +
    "(+3 :rb_might: while I'm a defender.)"
} satisfies CardProgram;
