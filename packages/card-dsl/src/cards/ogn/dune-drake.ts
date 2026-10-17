import type { CardProgram } from "../../ir/index.js";

/**
 * Dune Drake (ogn-131-298) — Unit, 5 energy, no printed power (Body), 5 Might.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-131-298):
 *   When I attack, give me +2 :rb_might: this turn if there is a ready enemy
 *   unit here.
 *
 * 规则依据（CR v1.5）：
 * - “When I attack”：攻击触发（383.4.e；时点 attack-declared，ruleRefs 323.2、383.4.e、
 *   466.2.c），filter 指向自身。
 * - 383.2.a.1：“if there is a ready enemy unit here” 紧跟在触发条件之后，属于 Trigger
 *   Condition（不是效果的一部分），在进链前判定。
 * - “give me +2 Might this turn”：临时 Might 修正，期限为本回合末（143.2.a、479 图层）。
 *   effect.buff 的边界注释明确临时 Might 归 layers 的 continuous.might，绝不写成 Buff
 *   counter（702/703 是另一回事）。
 *
 * status: judge-required（2026-10-17 实测）。Might 指令本体已能注册并在回合末到期，
 * 仍有两处当前缺口：
 * 1. 触发条件的两处锚点求值都不成立：
 *    - `controller: "opponent"` 是本卡的作者意图，但求值路径只有绝对 PlayerId。
 *      interpreter/selectors.ts 的 queryObjects 把 controller/owner 当普通标量比较
 *      （"opponent" 不等于 "A"/"B"），layers/filter.ts 的 selectorMatches 却把
 *      "opponent" 解释为“不等于 owner 自身”，两条路径语义不一致，
 *      ChainEngine.context().query() 走 layers/filter.ts 并额外把 "opponent" 展宽为
 *      "any" 后再逐对象排除，均与本卡 filter 的写法不匹配。
 *    - `sameLocationAs: "source"`（053.3 的「here」）在触发条件的求值路径上被丢弃：
 *      layers/filter.ts 的 matchesObjectFilter 不识别该锚点（只有 zone/type/
 *      controller/owner/states/tags/characteristics），而 interpreter/selectors.ts 的
 *      queryObjects 虽识别 sameLocationAs，却在相对玩家锚点处先失败。
 *    实测：只有 1 个 ready 敌方单位在此地时条件求值为 false（期望 true）；
 *    把 controller 换成绝对的 "B" 后同一局面为 true，证明缺口是相对玩家与位置锚点的接线。
 * 2. attack-declared 没有发射方：combat/flow.ts 的 combat start 在角色指派前
 *    抛 TurnCombatBlockedError('combat-start-transaction')（CR 466.2.c），
 *    因此 383.4.e 的攻击触发永远不会被真实战斗流程激发（见 azir-sovereign / fiora-peerless
 *    的同一缺口）。条件写法保留为可审查意图，不近似实现。
 *
 * 执行证据（RIFT-705 模板层，2026-10-17）：
 * packages/card-dsl/test/cards/templates/triggered-attack-declared-continuous-mig-705.test.mjs
 * 走真实路径断言：+2 Might 图层注册（arithmetic、amount 2、duration end-of-turn）、
 * 回合末到期、无有效宿主时的 ignored mistargeted，以及本卡触发条件的三处实测缺口
 * （相对玩家 "opponent" 求值 false、位置锚点被 layers/filter 丢弃、ready/here 计数本身可用）。
 * 该模板层只作为已可执行部分的执行证据，不把正文组合判定为 executable。
 */
export default {
  canonicalCardId: "card.hash-129e18f9d31400f8fce66c0a8cb60d4ca43ce586a107ec18cb24bee9d79e81d9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口（均已实测，不近似实现）：" +
    "（1）「if there is a ready enemy unit here」（383.2.a.1 的触发条件）缺锚点求值：" +
    "相对玩家 \"opponent\" 在 interpreter/selectors.ts 的 queryObjects 中被当普通标量比较（无法解析），" +
    "layers/filter.ts 的 selectorMatches 语义不同，ChainEngine.context().query() 还会把 \"opponent\" 展宽为 \"any\" 再逐对象排除；" +
    "同时位置锚点 sameLocationAs（053.3「here」）被 layers/filter.ts 的 matchesObjectFilter 丢弃，" +
    "programs/filters.ts 的 translateObjectFilter 对它直接抛「Unsupported filter field sameLocationAs」。" +
    "实测：只有 1 个 ready 敌方单位在此地时条件为 false（期望 true），改用绝对玩家 \"B\" 后为 true；" +
    "states:\"ready\" 与 count 谓词本身已可用。" +
    "（2）attack-declared 无发射方：combat/flow.ts 的 combat start 在角色指派前抛" +
    "TurnCombatBlockedError(\"combat-start-transaction\")（CR 466.2.c、383.4.e），真实战斗流程不会激发该触发。" +
    "continuous.might 与 end-of-turn 期限（RIFT-258/259）已合入并由 golden 执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "ready-enemy-units-here",
            filter: {
              type: "unit",
              controller: "opponent",
              states: "ready",
              sameLocationAs: "source"
            }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "dune-drake.grant-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            appliesTo: { kind: "constant", value: "self" }
          }
        }
      ]
    }
  ],
  sourceText:
    "When I attack, give me +2 :rb_might: this turn if there is a ready enemy unit here."
} satisfies CardProgram;
