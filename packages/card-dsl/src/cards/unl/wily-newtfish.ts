import type { CardProgram } from "../../ir/index.js";

/**
 * Wily Newtfish (unl-108-219) — Unit, Body, Bilgewater; energy 4, Might 4.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-108-219, verbatim):
 *   If you've gained XP this turn, I have +1 :rb_might: and [Ganking]. (I can
 *   move from battlefield to battlefield.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 364.3: "If you've gained XP this turn, I have …" is a Conditional Passive
 *   Ability — a static ability whose gate is re-evaluated as the game state
 *   changes (the condition is not a one-shot trigger).
 * - 728 / 730.1 / 730.2: gaining XP is a game action on the player, observed at
 *   the closed timing point "xp-gained" (events/timing-points.ts, payload
 *   previousXp/currentXp); "this turn" scopes the query to the current turn.
 * - 143.2.a: "+1 :rb_might:" without a duration is a continuous Might change in
 *   the arithmetic layer (contract 3.4 layer order), never a Buff counter (702).
 * - 810.1 / 810.1.b / 810.1.c: [Ganking] is a passive keyword that adds the
 *   Battlefield→Battlefield permission to the host's Standard Move; the
 *   reminder text is the printed explanation of that keyword.
 *
 * Status: judge-required (re-checked 2026-10-17, third sweep). What is merged and executable:
 * - The `continuous.might` and `continuous.grant-keyword` primitives resolve
 *   the declared `filter: { object: "self" }` selector (the interpreter's
 *   `resolveObjectSelector` reads `object` anchors through `queryObjects`) and the
 *   mathematical layer really applies +1 Might and the Ganking keyword to the host
 *   only — asserted in the golden through `runAbilityBody` plus `createLayerEngine`.
 * Two remaining gaps (none approximated):
 * - The "you've gained XP this turn" gate (364.3) still has no truthful
 *   evaluation path. The production static binder compiles the declared
 *   Condition into a per-object function (`programs/statics.ts`
 *   `abilityEnvironment` -> `effects/interpreter/condition.ts`), but the `count`
 *   half then runs the live set query and `filter: { player: "controller" }` is
 *   not read, so the host itself is counted and the gate is true with 0 XP.
 *   Measured with the production binder: with 0 XP the host gains +1 Might and
 *   Ganking. There is still no turn-history consumer for
 *   `controller-xp-gained-this-turn`.
 * - "and [Ganking]" still has no consumer in the movement system: the merged
 *   `continuous.grant-keyword` writes the keyword into the ability layer
 *   (verified), but `layers/rules/query.ts#movement` only reads the
 *   `continuous.movement` `permission.routes` shape, not a granted Ganking
 *   keyword (`movement()` reports canGank false while the layered host carries
 *   Ganking), and no production assembly supplies the Standard Move's trusted
 *   Ganking evaluator / `DuelMovementRuleContext` (`moveDuelUnitsWithMetadata`
 *   has no caller outside tests). 810.1.c / 144.4.c therefore cannot be proven.
 */
export default {
  canonicalCardId: "card.hash-55487ff54a21b4f984b21e9ef2babc80760bd74a2128eac7bd6665ff81432f9e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "已合入并可执行的部分：continuous.might 与 continuous.grant-keyword 原语按本卡声明的 { object: \"self\" } 选择符解析" +
    "（解释器 resolveObjectSelector/queryObjects 支持 object 锚点），数学图层真实给宿主 +1 Might 并写入 Ganking 关键词，" +
    "模板 golden 用真实场景断言只作用于宿主自身。整卡仍缺两处，均不近似实现：" +
    "(1)「If you've gained XP this turn」（364.3）仍无求值路径——生产 static binder 把该 Condition 编译成逐对象的函数并走 " +
    "effects/interpreter/condition.ts，但 count 仍是现场集合查询：filter.player（player: \"controller\"）不被读取，" +
    "宿主自身被计入，0 XP 时门槛也为真（实测生产 binder 下 0 XP 即给 +1 Might 与 Ganking）。仍缺 controller-xp-gained-this-turn " +
    "的回合历史消费方，0 XP 不发加成的印刷预期保留为 TODO。" +
    "(2)「and [Ganking]」在移动系统里仍无消费方：continuous.grant-keyword 已把关键词写入 ability 图层（已验证），" +
    "但 layers/rules/query.ts#movement 只读 continuous.movement 的 permission.routes 形态、不把已授予的 Ganking 关键词算作移动许可" +
    "（实测宿主图层关键词为 Ganking 时 movement() 的 canGank 仍为 false），且标准移动的 trusted Ganking evaluator / " +
    "DuelMovementRuleContext 没有生产装配（moveDuelUnitsWithMetadata 无测试外调用方），810.1.c/144.4.c 无法证明。" +
    "依赖：XP 回合历史谓词路径与 Ganking 关键词的移动许可消费方。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        filter: { object: "self" }
      },
      // 364.3 + 730.1：本回合控制者是否获得过 XP（求值路径缺失，见 judgeReason）。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "controller-xp-gained-this-turn",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    },
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Ganking",
        filter: { object: "self" }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "controller-xp-gained-this-turn",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "If you've gained XP this turn, I have +1 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)"
} satisfies CardProgram;
