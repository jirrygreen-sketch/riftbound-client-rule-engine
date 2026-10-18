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
 * - 811.1 / 811.1.a–c：Hidden 是执行 Hide 自由行动的关键词前置；按契约 3.7 与 README 第 5
 *   节只声明 { kind: "keyword", keyword: "hidden" }，展开由 effects/keywords/Hidden.ts 负责。
 * - 814.1 / 814.1.b.2 / 814.1.b.3 / 814.1.c：[Shield 3] 是把印刷数值 3 的 Shield 授予宿主
 *   自身；804/814.1.d 的 Defender designation 与可能的 +3 Might 修正都不由卡程序重写。
 * - 「while I'm at a battlefield with exactly one other unit you control」是授予 Shield 3 的
 *   门控条件：同地点（359.3.f 的 sameLocationAs 宿主）、其它单位恰好 1 个（355.9.c 的
 *   "other" 排除来源自身），写作 static ability 的 condition（契约 3.4）。
 *
 * status = judge-required（2026-10-18 M2 复核，四处当前缺口，均为实测，不近似实现）：
 * 1. [Hidden] 展开成 { kind: "cost.hidden" } 的 static，但实测
 *    createEngineStaticBinder().bindStatic 对它抛 ProgramBindingError
 *    ('Static ability kind cost.hidden has no layer mapping')，attachLifecycle 的 onError 会
 *    吞掉该异常（fail-closed）；811.1.d/811.5 的藏牌、811.6 的后续 [Reaction] 与 0 能量打出
 *    都没有执行路径。
 * 2. 条件授予侧的相对玩家选择符无法求值：实测 layers/filter.ts 的 selectorMatches 把
 *    controller: "controller" 当字面字符串比较（同一对象只有写成绝对玩家 id 才命中），
 *    生产路径里计数恒 0、条件恒假。
 * 3. 条件里的 sameLocationAs / exclude 在图层匹配器里被忽略：实测 matchesObjectFilter 对
 *    “不同战场”的单位同样返回 true，位置与“其它”语义都不参与匹配（355.9.c、359.3.f）。
 * 4. 授予后的关键词不展开：Shield 自身的条件读 "designation"，默认解释器实测抛
 *    MissingInformation: Unavailable characteristic: designation，814.1.c 的
 *    “防守者时 +3 Might” 不会发生；ObjectSnapshot.combatRole 也没有生产写入方。
 * golden 中的 condition.predicate 只覆盖解释器路径，且测试内核的玩家 id 恰好字面叫
 * “controller”——它不证明生产链路。
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
    "四处缺口，均实测、不近似实现：(1) [Hidden] 展开的 { kind: \"cost.hidden\" } static 在 bindStatic 抛 " +
    "ProgramBindingError('Static ability kind cost.hidden has no layer mapping')，attachLifecycle 的 onError 会吞掉（fail-closed）；" +
    "811.1.d/811.5 的藏牌、811.6 的后续 [Reaction] 与 0 能量打出都没有执行路径。" +
    "(2) 授予（continuous.grant-keyword 的静态注册入口已合入）侧的相对玩家选择符无法求值：实测 layers/filter.ts 的 selectorMatches 把 controller: \"controller\" 当字面字符串比较" +
    "（同一对象只有写成绝对玩家 id 才命中），生产路径里计数恒 0、条件恒假，814.1.c 的“恰好一个其它友方单位在此”无法被诚实求值。" +
    "(3) 条件的 sameLocationAs/exclude 在图层匹配器里被忽略：实测 matchesObjectFilter 对“不同战场”的单位同样返回 true，" +
    "位置与“其它”语义都不参与匹配（355.9.c、359.3.f）。" +
    "(4) 授予后的关键词不展开：Shield 条件读 \"designation\"，默认解释器实测抛 MissingInformation，" +
    "814.1.c 的“防守者时 +3 Might”不会发生；ObjectSnapshot.combatRole 也没有生产写入方。" +
    "golden 的 condition.predicate 只覆盖解释器路径，且测试内核的玩家 id 恰好字面叫 \"controller\"。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "I have [Shield 3] while I'm at a battlefield with exactly one other unit you control. " +
    "(+3 :rb_might: while I'm a defender.)"
} satisfies CardProgram;
