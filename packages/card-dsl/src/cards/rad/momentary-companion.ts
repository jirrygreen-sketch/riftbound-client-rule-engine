import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Momentary Companion (rad-095-167) — Unit, 4 energy, Might 4, Chaos。
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   When you play me, if it's not your turn, give me [Temporary]. (Kill me at
 *   the start of my controller's Beginning Phase, before scoring.)
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）以 keyword 能力声明；展开（cost.hidden、面朝下许可）属 RIFT-84。
 * - "When you play me"：card-played（383.4.a），filter 指向自身。
 * - "if it's not your turn"：触发条件比较当前回合玩家与能力控制者（"your" = 190.6.d
 *   的控制器）。条件写成 not(expression("current-turn-player-is-controller"))，即
 *   "本卡控制者不是当前回合玩家"；该谓词与它的求值路径都尚未合入（见 judgeReason），
 *   卡内不凭空读取回合状态，不近似实现。
 * - "give me [Temporary]"：816 的触发式关键词授予。816.1.b 规定 [Temporary] 的功能等价于
 *   "At the start of this permanent's controller's Beginning Phase, before scoring, kill this."，
 *   其展开属关键词注册表（当前没有 Temporary.ts）；本卡以 continuous.grant-keyword 描述
 *   该授予，由 layers（契约 3.7）消费。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { self: true },
      condition: {
        kind: "not",
        condition: {
          kind: "expression",
          value: { kind: "constant", value: "current-turn-player-is-controller" }
        }
      }
    },
    optional: false,
    body: [
      {
        id: "momentary-companion.grant-temporary",
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "Temporary" },
          duration: { kind: "constant", value: "permanent" }
        },
        targets: [
          {
            id: "momentary-companion.self",
            filter: { type: "unit", object: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-acd7471a82a9a0d5caee4793bb24dd67313afca36a5e9b63e8e43bb188c5e0d4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处依赖未合入：(1) 条件「if it's not your turn」需要「当前回合玩家」与能力控制者的比较，" +
    "当前 Condition 没有该谓词，卡内不能凭空读取回合状态（不近似实现）；" +
    "(2) 「give me [Temporary]」是 816 的关键词授予（816.1.b 的功能等价文本含" +
    "「在该永久物控制者的 Beginning Phase 开始时、计分前消灭它」），需要 Temporary 的 KeywordDef" +
    "与 continuous.grant-keyword 持续效果（layers，RIFT-91）；[Hidden]（811）的展开也属 RIFT-84。" +
    "已合入的部分：card-played 触发结构与 continuous.grant-keyword 的结构形状（由 layers 消费），" +
    "本卡不含可独立真实执行的已注册原语体，故只做校验与结构测试。依赖：RIFT-91、RIFT-84、Temporary 关键词任务。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, if it's not your turn, give me [Temporary]. (Kill me at the start of my controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default program;
