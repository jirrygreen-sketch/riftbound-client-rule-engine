import type { CardProgram } from "../../ir/index.js";

/**
 * Angler Beast (unl-132-219) — Unit, Chaos, tag Bilgewater。
 * catalog：energy 5、power 1、might 5。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-132-219，逐字）：
 *   When you play me, return all units with 2 :rb_might: or less to their owners' hands.
 *
 * 规则依据（CR v1.5）：
 * - “When you play me” 是 Play Effect（383.4.a.1/383.4.a.2），时点 card-played、filter
 *   指向自身。
 * - “all units with 2 [M] or less”：按特征自动选定的完整集合，没有可做的选择
 *   （355.10.d：程序化选定的对象不是目标），因此用 `selection: "all"`、`min: 0`
 *   （同 ogn/kogmaw-caustic、rad/the-ball 的集合写法），不是 “up to”。Might 阈值是
 *   355.9.b 一类的特征限制。
 * - “to their owners' hands”：区域路由到各牌拥有者的手牌，由 effect.zone 的 hand
 *   目的地与内核的 move/return-to-hand 动作负责（CR 108/124：非棋盘区域移动产生新对象身份）。
 *
 * status = judge-required（缺口不近似实现）：
 * - 「2 [M] or less」的 Might 上限在已合入代码里没有判定路径：冻结的 ObjectFilter 没有
 *   Might 谓词，已合入的过滤器（layers/filter.ts 的 matchesObjectFilter 与测试内核的
 *   matchesFilter）只按 type/zone/controller/tags/characteristics 等字段匹配，未知键
 *   （如这里的 mightLte）会被静默忽略——若按已实现对待，Angler Beast 会把场上**所有**
 *   单位回手，而不只是 Might ≤ 2 的那些。355.9.b 的阈值限制需要 143.2.a 的有效 Might
 *   读取与阈值谓词（与 sfd/sandshifter、ogn/gust 记录同一缺口）。
 * 已合入且可执行的是回手动作本体：golden 用解释器 + 参考内核真实执行 effect.zone（对已锁定
 * 的弱单位集合回手，且强单位留在场上），并按 359.3.e 验证失效引用被忽略。
 *
 * 依赖：RIFT-81~91（Mighty 类 Might 谓词与目标/图层过滤）与 RIFT-90 的目标查询场景。
 */
export default {
  canonicalCardId:
    "card.hash-9b3883fe3c4d9bfa96f4dcf2d8d03f9c48fe8987802cd8e669ef1c5802bf3fc6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Might 上限过滤：冻结的 ObjectFilter 没有 Might 谓词，已合入的过滤器（layers/filter.ts 的 " +
    "matchesObjectFilter 与测试内核的 matchesFilter）只按 type/zone/controller/owner/tags/characteristics 等字段匹配，" +
    "未知键（程序里的 mightLte）会被静默忽略——按已实现对待会让本卡把场上所有单位（含 Might ≥ 3 的）都回手；" +
    "355.9.b 的「2 [M] or less」需要 143.2.a 的有效 Might 读取与阈值谓词（与 sfd/sandshifter、ogn/gust 同一缺口）。" +
    "回手本体 effect.zone（to: hand，各牌按拥有者路由）已合入，golden 用解释器 + 参考内核对该集合真实执行，" +
    "并验证 359.3.e 的失效引用被忽略。依赖：RIFT-81~91（Might 谓词/过滤）、RIFT-90（目标查询）。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "angler-beast.return-weak-units",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "angler-beast.weak-units" },
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "angler-beast.weak-units",
              // “all units with 2 [M] or less”：按特征选定的完整集合（355.10.d）。
              // mightLte 是描述性键：已合入过滤器不识别它（见 judgeReason），
              // 真实执行由 Finalize 按 143.2.a 的有效 Might 锁定成员后交解释器。
              filter: { type: "unit", zone: "board", mightLte: 2 },
              min: 0,
              selection: "all"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play me, return all units with 2 :rb_might: or less to their owners' hands."
} satisfies CardProgram;
