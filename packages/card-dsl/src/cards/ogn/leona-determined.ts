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
 * status: judge-required —— [Shield] 的展开、continuous.might 图层注册和卡牌 static 生命周期
 * 已合入，golden 已覆盖 +1 Might 的注册路径；但 Shield 展开的 condition 读取
 * designation === "defender"，而当前 ObjectSnapshot 只有 combatRole，条件会缺少可读的
 * Defender 特征。另一个生产接线缺口是攻击效果的 TargetSpec 使用 sameLocationAs: "source"，
 * programs/filters.ts 尚不接受该字段，故同地点约束不能按声明绑定。
 * "When I attack, stun an enemy unit here" 的 effect.stun 本体已在解释器中真实执行。
 */
const leonaDetermined = {
  canonicalCardId: "card.hash-5cbcf053019f85d2ed95e9f9710c31e3286d72d0e93b515699b5b03dc6f9d0e4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Shield]（814.1.c，未写数值按 814.1.b.3 = 1）的 KeywordDef 与 continuous.might 图层注册已合入，" +
    "但展开条件读取 designation === \"defender\"，当前 ObjectSnapshot 只提供 combatRole，缺少可执行的 Defender 特征映射；" +
    "同一攻击触发中的 TargetSpec 还使用 sameLocationAs: \"source\"，而 programs/filters.ts 的生产翻译器拒绝该字段，" +
    "所以“here”约束不能按声明绑定。attack-declared、effect.stun 及解释器侧同地点查询已有真实执行证据。" +
    "依赖：combatRole/designation 条件映射与 TargetSpec sameLocationAs 的生产翻译。",
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
