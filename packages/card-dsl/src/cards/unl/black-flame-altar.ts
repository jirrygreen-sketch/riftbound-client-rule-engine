import type { CardProgram } from "../../ir/index.js";

/**
 * Black Flame Altar (unl-208-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-208-219, 逐字):
 *   "Units here with [Temporary] have [Shield]. (+1 :rb_might: while they're
 *    defenders.)"
 *
 * CR v1.5 anchors:
 * - 814.1.a / 814.1.c: [Shield] is a Passive Ability keyword present on Units
 *   and functionally short for "While I am a defender, I have +X [M]"; the
 *   printed parenthetical restates exactly that (814.1.c), so it adds no
 *   separate ability here.
 * - 814.1.b.3: [Shield] with no value is presumed to be Shield 1.
 * - 816.1 / 816.3: [Temporary] is a Triggered Ability keyword of permanents,
 *   and whether a permanent has Temporary is a readable characteristic — the
 *   grant's "with [Temporary]" is therefore a keyword predicate on the unit.
 * - 476 / 477: "Units here … have [Shield]" is a continuous (layer) ability
 *   that changes what the Game Objects are: the keyword belongs in the ability
 *   layer (contract §3.4 layer order copy → trait → ability → arithmetic).
 * - 053.3 / 199.1: "here" is this Battlefield, so the affected units are the
 *   units whose location is this Battlefield.
 *
 * Status: judge-required (re-reviewed 2026-10-17) — the Temporary KeywordDef landed
 * (RIFT-265), so "has [Temporary]" is now a real registry characteristic, but the
 * grant still has no merged execution path and nothing here is approximated:
 * 1. nothing registers a CardProgram's static ability as a
 *    ContinuousEffectSpec: `registerContinuousEffect` has no caller, and
 *    RIFT-257's attachLifecycle needs a ProgramStaticBinder implementation that
 *    does not exist. The layers ability layer can apply a
 *    `continuous.grant-keyword` effect (engine.ts `applyAbility` reads
 *    effect.keyword/keywords), but it must be handed the registration by a
 *    caller that is still missing (same gap as ogn/fortified-position,
 *    rad/firelights-hideout).
 * 2. the printed gate cannot be evaluated by the merged matchers:
 *    `layers/filter.ts` implements no sameLocationAs anchor (#[OBJECT_FILTER_ANCHORS]
 *    is resolved by the interpreter's query path, not by the layer matcher) and no
 *    keyword predicate (it never reads `keywords`); `conditionMatches` returns true
 *    for every condition kind except always/never/type/has-tag/has-keyword — but
 *    that branch is the *effect* condition, not a filter, so registering this
 *    effect as written would apply [Shield] to units at every Battlefield. The
 *    program therefore keeps the intended layer shape so the gaps stay auditable;
 *    the golden asserts identity, structure and the exact filters.
 *
 * Dependencies: RIFT-257 (card static registration and a ContinuousEffectSpec
 * binder; the layers filter also needs the sameLocationAs and keyword predicates),
 * and the Shield expansion consumer (814.1.c: +1 Might while the unit is a defender,
 * whose `designation` condition is not evaluated by the layer engine either).
 */
export default {
  canonicalCardId: "card.hash-c4cfa13109f9e65730089b31964d83518df125baae9a5cb10592187c82a44c56",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) 没有任何已合入路径把 CardProgram 的 static 能力注册成 layers/LayerEngine 的 ContinuousEffectSpec" +
    "（registerContinuousEffect 没有调用方，engine-core 不读取卡牌能力；ability 层的 applyAbility 会消费 continuous.grant-keyword，" +
    "但需要尚不存在的调用方与 ProgramStaticBinder 实现，同 ogn/fortified-position、rad/firelights-hideout；RIFT-257）。" +
    "(2) 印刷的两道门无法被已合入匹配器求值：layers/filter.ts 既不实现 053.3 的 sameLocationAs 锚点（该锚点只在解释器的 query 路径解析），" +
    "也没有关键词谓词（它从不读取 keywords）；条件匹配只认 always/never/type/has-tag/has-keyword 这类 effect condition，过滤器维度没有对应入口。" +
    "按现状注册会把 [Shield] 加到所有战场上的单位，与「Units here with [Temporary]」不符（过度应用，不得据此标 executable）。" +
    "已合入部分：[Temporary] 的 KeywordDef（effects/keywords/Temporary.ts，RIFT-265：816.1.b 的 beginning-start 触发）与 Shield 自身的规则语义" +
    "（keywords/Shield.ts，814.1.b.3 默认值 1；括号内文字只是 814.1.c 的复述）都已存在，但被授予的 Shield 还需要 814.1.c 的 defender 条件消费方" +
    "（layers 不读取 designation）。程序保留目标范围、ability 图层与 Temporary 门的具体形状供审查。" +
    "依赖：RIFT-257（卡牌 static 注册与 binder 实现，含图层过滤器的 sameLocationAs/关键词谓词）、Shield 展开消费方。",
  sourceText:
    "Units here with [Temporary] have [Shield]. (+1 :rb_might: while they're defenders.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        // 814.1.b.3: the printed [Shield] has no value, so the granted keyword
        // is Shield 1; the expansion lives in keywords/Shield.ts.
        keywords: [{ id: "shield", value: 1 }],
        // 476/477: changing what the objects are belongs in the ability layer
        // (contract §3.4 layer order copy → trait → ability → arithmetic).
        layer: "ability",
        filter: {
          type: "unit",
          zone: "board",
          // 053.3/199.1: "here" is this Battlefield. The anchor is not
          // implemented by the merged layer filter (see judgeReason).
          sameLocationAs: "self",
          // 816.3: "with [Temporary]" is a keyword characteristic gate; no
          // merged matcher implements a keyword predicate yet, so this key is
          // declarative (the merged filter ignores unknown keys, which is why
          // the effect must not be registered as written today).
          keywords: ["Temporary"]
        }
      }
    }
  ]
} satisfies CardProgram;
