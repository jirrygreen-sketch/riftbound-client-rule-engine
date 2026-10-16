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
 * status: judge-required —— [Shield] 的展开文件已合入（keywords/Shield.ts），但其消费者未合入：
 * 该文件自身注明 "continuous.might ... 尚无已注册原语或图层求值器消费它"，且 Shield 的
 * condition（读 designation === "defender"）当前无法被解释器/图层求值；卡牌程序的 static 效果
 * 也没有进入 layers 的接线。整张卡因此不能标 executable。
 * "When I attack, stun an enemy unit here" 的触发与原语已合入，golden 测试真实执行该指令。
 */
const leonaDetermined = {
  canonicalCardId: "card.hash-5cbcf053019f85d2ed95e9f9710c31e3286d72d0e93b515699b5b03dc6f9d0e4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Shield]（814.1.c，未写数值按 814.1.b.3 = 1）的展开文件已合入，但其消费者未合入：" +
    "keywords/Shield.ts 自身注明 continuous.might 尚无已注册原语/图层求值器消费它，" +
    "且其 condition（Defender designation 读取）当前无法求值，卡牌 static 效果也没有进 layers 的接线；" +
    "「When I attack, stun an enemy unit here」部分（attack-declared + effect.stun + sameLocationAs 锚点）已合入并已执行测试。" +
    "依赖：RIFT-91（layers-continuous：continuous.might 与 designation 条件求值）。",
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
