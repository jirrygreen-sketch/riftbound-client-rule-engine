import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Windsinger (sfd-138-221) — Unit, Chaos, Ionia.
 * energy 2, power: none printed, Might 1.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-138-221，逐字，含换行）:
 *   "Hidden (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n"
 *   "When you play me, you may return another unit at a battlefield with 3 :rb_might: or less to its owner's hand."
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811.1）：Hide 前提关键词。按契约 3.7 只声明关键词，展开（cost.hidden 静态效果）
 *   由已合入的 effects/keywords/Hidden.ts 负责，卡牌不重写。
 * - "When you play me"：383.4.a / 383.4.a.1 的 Play Effect（420.4.a 在打出动作完成后进链），
 *   时点 card-played，filter 用内层锚点 source: "self" 指称本卡（与已合入
 *   sfd/trove-golem、sfd/sandshifter、ogn/the-good-stuff 同型）。
 * - "you may …"（403.1、383.3.e.2）：效果首段是 "you may"，契约 3.9 要求把被选指令包进
 *   choice.optional 的 body；355.12 要求 may-action 的所有选择随该动作一起做，因此 TargetSpec
 *   挂在 choice.optional 节点上随 Finalize 锁定（与已合入的 sfd/disarming-rake 同型）。
 * - "another unit at a battlefield"：355.7/355.9.a.1 规定玩家要选的对象是目标；
 *   "another" 排除来源自身（355.9.c，用符号选择器 exclude: "source"——契约 3.6 的对象锚点，
 *   与已合入 sfd/ribbon-dancer 同型），"at a battlefield" 是位置限制（355.10.b，写
 *   location: "battlefield"）。
 * - "to its owner's hand"：区域移动用封闭 GameAction return-to-hand，经 effect.zone
 *   （to: "hand"）提交，拥有者路由由内核负责（契约 3.6；448.2 的换区不是 Move）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - "with 3 :rb_might: or less" 是 143.2.a 的有效 Might 上限目标限制（355.9.b 的同类示例是
 *   "a unit with Might 4 or greater"），但冻结的 ObjectFilter 没有 Might 谓词、也没有消费者读取：
 *   layers/filter.ts 的 matchesObjectFilter 只按 objectId/cardId/type/zone/location/controller/
 *   owner/states/tags/characteristics 匹配，测试内核的 matchesFilter 只按 type/types/tag/tags/
 *   controller/owner/zone/location 匹配，未知键（程序里的 mightLte）会被静默忽略——
 *   把它当已实现会让本卡能回手任意单位（同 sf d/sandshifter 的同一缺口）。
 * - [Hidden] 的展开（cost.hidden）没有消费方：Hide 动作、facedown 区与从 facedown 打出的免费许可
 *   都属 RIFT-89（effects/keywords/Hidden.ts 文件头记录同一依赖）。
 * - card-played 触发的卡牌注册（CardProgram → TriggerRegistration）与内层锚点 source: "self"
 *   的消费方尚未合入（events/pipeline-match.ts 只读 EventPattern 的 object/source/target/player/
 *   fromZone/toZone/amount/details），属 RIFT-120。
 * 依赖：Might 阈值谓词（RIFT-81~91 的 Mighty 类过滤 + RIFT-32/33 图层与目标查询场景）、
 * RIFT-89（cost.hidden / Hide 路径）、RIFT-120（触发注册与事件载荷）。
 * 不近似实现：不省略 "another" 排除，不省略 Might 上限，也不用直接改区域代替 return-to-hand。
 */
const RETURN_TARGET = "windsinger.other-small-unit";

const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    // 403.1 的 "you may" 是效果层的可选包装（契约 3.9），触发本身是非可选的。
    optional: false,
    body: [
      {
        id: "windsinger.may-return",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Return another unit at a battlefield with 3 Might or less to its owner's hand?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "windsinger.return-to-hand",
                op: "effect.zone",
                args: {
                  target: { kind: "constant", value: RETURN_TARGET },
                  to: { kind: "constant", value: "hand" },
                  amount: { kind: "constant", value: 1 }
                }
              }
            ]
          }
        },
        targets: [
          {
            id: RETURN_TARGET,
            // Might 上限只有描述性：355.9.b / 143.2.a 需要有效 Might 读取与阈值谓词，
            // 现有过滤器会静默忽略 mightLte（见 judgeReason），绝不能当作已生效的限制。
            filter: {
              type: "unit",
              zone: "board",
              location: "battlefield",
              exclude: "source",
              mightLte: 3
            },
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
  canonicalCardId: "card.hash-75f4edacd5ddc4bb087703bc231650c3942cea51f1bdb7b370bd27a6da6fd390",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "(1)「another unit at a battlefield with 3 :rb_might: or less」的 Might 上限无法求值：冻结的 ObjectFilter 没有 Might 谓词，" +
    "已合入的过滤器（layers/filter.ts 的 matchesObjectFilter、测试内核的 matchesFilter）只按 type/zone/controller/tags/characteristics " +
    "等字段匹配，未知键（程序里的 mightLte）会被静默忽略——把它当已实现会让 Windsinger 能回手任意单位；355.9.b 的「单位 Might ≥ 4」类限制" +
    "需要 143.2.a 的有效 Might 读取与阈值谓词（RIFT-81~91 / RIFT-32/33）。" +
    "(2) [Hidden]（811.1）的展开只声明 cost.hidden 静态效果，Hide 动作、facedown 区与从 facedown 打出的许可都没有消费方（RIFT-89，" +
    "effects/keywords/Hidden.ts 文件头同款依赖）。" +
    "(3) card-played 触发没有 CardProgram → TriggerRegistration 的注册接线，且 filter 的内层锚点 source: \"self\" 没有消费方" +
    "（events/pipeline-match.ts 只读 EventPattern 的 object/source/target/player/fromZone/toZone/amount/details），属 RIFT-120。" +
    "effect.zone 的 trash/hand 回手段与 355.12 的 may 选择形状均已合入并由 golden 真实执行（锁定目标的回手）。不近似实现。",
  abilities,
  sourceText:
    "Hidden (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "When you play me, you may return another unit at a battlefield with 3 :rb_might: or less to its owner's hand."
} satisfies CardProgram;

export default program;
