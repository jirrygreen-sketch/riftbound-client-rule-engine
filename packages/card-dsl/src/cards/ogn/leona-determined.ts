import type { CardProgram } from "../../ir/index.js";

/**
 * Leona, Determined (ogn-238-298) - Unit, Order, Leona/Mount Targon/Champion (M2 unit shard 12).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-238-298):
 *   [Shield] (+1 :rb_might: while I'm a defender.)
 *   When I attack, stun an enemy unit here. (It doesn't deal combat damage this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 814.1 / 814.1.b.3 / 814.1.c / 814.1.d.1：Shield 是被动能力关键词，未写数值时按 1；
 *   功能上等价于"我是防御者时 +1 [M]"；展开由 keywords/Shield.ts 负责
 *   （condition 读 Defender designation）。
 * - 383.4.e / 466.2.c：Attack Trigger 在单位取得 Attacker 身份时入链（时点 attack-declared，
 *   见 events/timing-points.ts 的 attack-declared，ruleRefs 323.2/383.4.e/466.2.c）。
 * - 359.3.f.1 / 359.3.f.2：正文里的 "here" 引用能力来源的信息，在指令执行时检查；
 *   本卡用 ObjectSelector "source" + ObjectFilter 锚点 sameLocationAs 表达"同一地点"
 *   （解释器负责把选择器解析为运行时引用）。
 * - 355.9 / 355.10："an enemy unit" 是目标（controller 限制），不是集合。
 * - 424.1 / 424.1.a / 424.1.a.1 / 424.1.b / 424.1.c：Stun 是效果型受限动作；已 Stunned 的
 *   单位不能被再次 Stun；Stunned 单位在战斗伤害步骤不贡献 Might（即不造成战斗伤害）。
 *
 * status: judge-required（2026-10-17 复核）—— 两处已实测缺口：
 * 1. [Shield] 的 KeywordDef 展开、continuous.might 图层注册与 static 生命周期已合入，
 *    但展开条件读 designation === "defender"，默认求值（expr.ts）只查 ObjectSnapshot 自身字段，
 *    对 designation 抛 MissingInformation、statics 包装吞成 false；实测 combatRole="defender" 时
 *    might 仍为印刷值。RIFT-711 的 expr-ext/evaluate.ts 已支持该映射，但没有接进
 *    expr.ts / layers/engine.ts / programs/statics.ts。
 * 2. 攻击效果的 TargetSpec 用 sameLocationAs: "source"，programs/filters.ts 的
 *    translateObjectFilter 允许字段集合不含该锚点，translateInstructionTargets 实测抛
 *    "Unsupported filter field sameLocationAs"，整条触发注册失败。
 * "When I attack, stun an enemy unit here" 的 effect.stun 本体与解释器侧同地点查询
 * （effects/interpreter/selectors.ts 的 sameLocationAs 锚点）已在解释器中真实执行。
 */
const leonaDetermined = {
  canonicalCardId: "card.hash-5cbcf053019f85d2ed95e9f9710c31e3286d72d0e93b515699b5b03dc6f9d0e4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处已实测的当前缺口：(1) [Shield]（814.1.c，未写数值按 814.1.b.3 = 1）的 KeywordDef 与 continuous.might " +
    "图层注册已合入，但展开条件读取 designation === \"defender\" 没有生产派发：effects/interpreter/condition.ts → expr.ts " +
    "只查 ObjectSnapshot 自身字段，对 property \"designation\" 抛 MissingInformation、包装层吞成 false；" +
    "实测 combatRole=\"defender\" 时 might 仍为印刷值，+1 恒不生效。RIFT-711 的 expr-ext/evaluate.ts 已能把 " +
    "designation/object-designation 映射到 combatRole，但 expr.ts、layers/engine.ts、programs/statics.ts 未引用它（0 处导入）。" +
    "(2) 攻击触发的 TargetSpec 使用 sameLocationAs: \"source\"，而 programs/filters.ts 的 translateObjectFilter 允许字段集合" +
    "不含该锚点，translateInstructionTargets 实测抛 \"Unsupported filter field sameLocationAs\"，" +
    "所以 registerProgramTriggers 整条注册失败、“here”约束不能按声明绑定（359.3.f.1/f.2）。" +
    "attack-declared、effect.stun 与解释器侧同地点查询（effects/interpreter/selectors.ts 的 sameLocationAs 锚点）" +
    "已有真实执行证据。依赖：combatRole/designation 条件派发与 TargetSpec sameLocationAs 的生产翻译。",
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "When I attack, stun an enemy unit here. (It doesn't deal combat damage this turn.)",
  abilities: [
    { kind: "keyword", keyword: "shield", value: 1 },
    {
      kind: "triggered",
      trigger: { at: "attack-declared", filter: { source: "self" } },
      optional: false,
      body: [
        {
          id: "leona-determined.stun-enemy-here",
          op: "effect.stun",
          args: { target: { kind: "constant", value: "leona-determined.enemy-here" } },
          targets: [
            {
              id: "leona-determined.enemy-here",
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                // 359.3.f："here" 引用来源的地点（本卡所在战场）。
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
  ]
} satisfies CardProgram;

export default leonaDetermined;
