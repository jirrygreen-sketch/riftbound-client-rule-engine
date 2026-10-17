import type { CardProgram } from "../../ir/index.js";

/**
 * Yasuo, Remorseful (ogn-076-298).
 * CR v1.5 383.4.e.1-383.4.e.2.a: first attacker designation per combat.
 * CR 418 / 740.1.b: damage uses the source's current Might and targets one enemy here.
 * No printed-Might constant, manual damage action, or single-card resolver is used.
 * The dynamic amount, the once-per-combat trigger scope and the interpreter's
 * source-location query anchor are merged and exercised by the golden tests; the
 * remaining production gaps are recorded below.
 *
 * Re-checked 2026-10-17 (all three gaps measured):
 * 1. Production target binding still rejects the filter-level sameLocationAs
 *    anchor: programs/filters.ts translateObjectFilter throws
 *    ProgramBindingError "Unsupported filter field sameLocationAs"
 *    (OBJECT_FILTER_ANCHORS is only honoured by the interpreter's query path).
 * 2. The TargetSpec-level relative location selector does not exist in the DSL
 *    validator yet: validateTarget routes every non-concrete value through
 *    validateLocationFilter, so target.location "source-location" (or
 *    { kind: "source-location" } / { kind: "location-of", object: "source" })
 *    is rejected with invalid-location-filter / invalid-location-kind even
 *    though engine-core/src/target/location accepts those runtime selectors.
 * 3. The declared trigger filter spelling is not normalized by the production
 *    translator: programs/filters.ts only folds source / role / self:true /
 *    objectId:"self" into an object anchor, so { object: "self" } throws
 *    "Expected a filter object". The merged sibling spelling is
 *    { event, filter: { source: "self" } }.
 * 4. The raw ResolveContext query exposed by bindResolveContext also ignores
 *    the sameLocationAs anchor (both enemies come back); only the interpreter's
 *    internal queryObjects wrapper applies it.
 * 5. The combat flow has no producer for the CR 383.4.e attack-declared event:
 *    combat/flow.ts throws TurnCombatBlockedError for the atomic combat start
 *    and the simultaneous damage transaction, so only declarations and test
 *    emissions exist for that timing point.
 * Nothing is approximated.
 */
const program = {
  canonicalCardId: "card.hash-751e2b1c16ab2529b3d0bf37e5309cfde9a7b41589d08799cf53a9a8ef42e5e8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 2026-10-17（三处缺口均已实测，均不近似实现）：effect.damage 的动态来源 Might、attack-declared 订阅与 " +
    "once: per-combat 绑定均已有合入执行路径；但 (1)「an enemy unit here」的 filter 级 sameLocationAs 锚点仍被生产绑定拒绝——" +
    "programs/filters.ts 的 translateObjectFilter 实测抛 ProgramBindingError「Unsupported filter field sameLocationAs」；" +
    "(2) 改用 TargetSpec 级相对位置选择器也不可行：IR 校验（ir/validation.ts 的 validateTarget）把非具体 battlefield/base 值一律当作 " +
    "LocationFilter 检查，location \"source-location\"、{ kind: \"source-location\" } 与 { kind: \"location-of\", object: \"source\" } " +
    "都实测被拒（invalid-location-filter / invalid-location-kind），而 RIFT-357 合入的 engine-core/src/target/location 已能解析这些运行时选择器；" +
    "(3) 声明的触发过滤拼写 { object: \"self\" } 也不被生产翻译器归一化——programs/filters.ts 只折叠 source / role / self:true / " +
    "objectId:\"self\"，实测该拼写抛「Expected a filter object」，而已合入的姊妹写法是 { event, filter: { source: \"self\" } }；" +
    "(4) bindResolveContext 暴露的 query 同样忽略 sameLocationAs 锚点（实测返回两个敌方单位），只有解释器内部 queryObjects 包装会应用它；" +
    "(5) 当前 combat flow 没有把单位首次取得攻击身份的 CR 383.4.e 事件接进该卡的真实触发链——combat/flow.ts 在 combat start 与同时伤害处" +
    "直接抛 TurnCombatBlockedError，attack-declared 只有声明与测试发射。依赖：生产过滤器接受相对位置锚点/触发拼写（或 IR 校验放开 TargetSpec 相对位置选择器）" +
    "与 attack-declared 的生产发射方。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: {
          object: "self"
        },
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          id: "deal-might",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: "source",
              property: "might"
            },
            target: {
              kind: "constant",
              value: "enemy-here"
            }
          },
          targets: [
            {
              id: "enemy-here",
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                sameLocationAs: "source"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When I attack, deal damage equal to my Might to an enemy unit here."
} satisfies CardProgram;

export default program;
