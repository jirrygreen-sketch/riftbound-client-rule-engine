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
 * Status: judge-required (re-checked 2026-10-16). What is merged and executable:
 * - RIFT-258's `continuous.might` and `continuous.grant-keyword` primitives resolve
 *   the declared `filter: { object: "self" }` selector (the interpreter's
 *   `resolveObjectSelector` reads `object` anchors through `queryObjects`) and the
 *   mathematical layer really applies +1 Might and the Ganking keyword to the host
 *   only — asserted in the golden through `runAbilityBody` plus `createLayerEngine`.
 * Three merged gaps (none approximated):
 * - The "you've gained XP this turn" gate (364.3) still has no evaluation path:
 *   the frozen Condition algebra (always / never / expression / compare / all /
 *   any / not) has no history node, and the `xp-gained` timing point is only a
 *   payload definition — nothing reads it as a static-ability predicate. The
 *   interpreter's `condition.history` instruction exists, but a static layer
 *   effect's condition is consumed by `layers/engine.ts` `conditionMatches`,
 *   which only knows always/never/type/has-tag/has-keyword and returns true for
 *   everything else, so binding the declared gate blindly would grant the bonus
 *   with 0 XP. The retained `count` subject is a descriptive shape, not an
 *   evaluation.
 * - No merged producer turns a CardProgram static ability into a
 *   ContinuousEffectSpec: `ResolveContext.addContinuous` (contract 3.6) is the only
 *   registration channel and it is reached from instructions, not from card data;
 *   `programs/statics.ts` exposes only the opaque `bindStatic` callback and no
 *   merged module implements it. The card needs that wiring (RIFT-257 follow-up)
 *   before the declared effect can register.
 * - "and [Ganking]" still has no consumer in the movement system: the merged
 *   `continuous.grant-keyword` writes the keyword into the ability layer
 *   (verified), but `zones/movement.ts` and `effect.move` never read a movement
 *   permission, and the `continuous.movement` producer only fills
 *   `layers/rules/query.ts#movement`'s `routes` form (`permission.routes`), not the
 *   Ganking KeywordDef's `permission: "battlefield-to-battlefield"` spelling —
 *   `rules.query` returns canGank false for the keyword grant (verified with a
 *   probe). 810.1.c / 144.4.c therefore cannot be proven.
 */
export default {
  canonicalCardId: "card.hash-55487ff54a21b4f984b21e9ef2babc80760bd74a2128eac7bd6665ff81432f9e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "已合入并可执行的部分：RIFT-258 的 continuous.might 与 continuous.grant-keyword 原语按本卡声明的 { object: \"self\" } 选择符解析" +
    "（解释器 resolveObjectSelector/queryObjects 已支持 object 锚点），数学图层真实给宿主 +1 Might 并授予 Ganking，golden 用 " +
    "runAbilityBody + createLayerEngine 断言只作用于宿主自身。整卡仍缺三处，均不近似实现：" +
    "(1)「If you've gained XP this turn」（364.3）仍无求值路径——冻结的 Condition 只有 always/never/expression/compare/all/any/not，" +
    "没有历史节点，events/timing-points.ts 的 xp-gained 只是载荷定义、没有静态谓词读取方；解释器的 condition.history 指令存在，" +
    "但静态图层效果的 condition 由 layers/engine.ts 的 conditionMatches 消费，它只识别 always/never/type/has-tag/has-keyword，" +
    "其余一律返回 true，直接绑定门槛会在 0 XP 时也发放加成。程序里的 count subject 只是描述形状，不构成求值。" +
    "(2) 没有已合入路径把 CardProgram 的 static 能力注册成 ContinuousEffectSpec：契约 3.6 的 ResolveContext.addContinuous 是唯一注册通道，" +
    "只能从指令到达；programs/statics.ts 只暴露不透明的 bindStatic 回调，没有任何已合入实现（RIFT-257 后续）。" +
    "(3)「and [Ganking]」在移动系统里仍无消费方：continuous.grant-keyword 已把关键词写入 ability 图层（已验证），但 zones/movement.ts 与 " +
    "effect.move 都不读取移动许可，而 continuous.movement 只填 layers/rules/query.ts#movement 的 permission.routes 形态、" +
    "不识别 Ganking KeywordDef 的 permission: \"battlefield-to-battlefield\" 拼写（探针显示该授权下 rules.query 的 canGank 仍为 false），" +
    "810.1.c/144.4.c 无法证明。依赖：XP 历史谓词路径与 RIFT-257 后续的卡牌静态注册、移动许可消费方。",
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
