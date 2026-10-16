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
 * Status: judge-required. Three merged gaps (none approximated):
 * - The "you've gained XP this turn" gate has no merged evaluation path for a
 *   static ability: the frozen Condition algebra (always / never / expression /
 *   compare / all / any / not) contains no history node, and although the
 *   interpreter registers a `condition.history` instruction (HistoryQuery
 *   scope/action/timingPoint/player/object), a static layer effect's condition is
 *   evaluated by the layers engine's own conditionMatches, which does not know
 *   it. The retained `count` subject is a descriptive shape, not an evaluation.
 * - "I have +1 :rb_might:" needs a continuous.might arithmetic-layer effect; no
 *   merged producer turns a CardProgram static ability into a
 *   ContinuousEffectSpec, and the layer engine's conditionMatches does not
 *   evaluate `compare`, so the gate could not be honoured (RIFT-91 delivered the
 *   layer engine, not the card wiring).
 * - "and [Ganking]" needs a continuous.grant-keyword effect plus a consumer in
 *   the movement system (contract 3.7); the Ganking KeywordDef is merged, but
 *   zones/movement.ts and effect.move never read that permission.
 */
export default {
  canonicalCardId: "card.hash-55487ff54a21b4f984b21e9ef2babc80760bd74a2128eac7bd6665ff81432f9e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「If you've gained XP this turn」是静态条件式被动能力（364.3）的门槛，" +
    "但冻结的 Condition 只有 always/never/expression/compare/all/any/not，没有历史节点；解释器虽有 condition.history 指令" +
    "（HistoryQuery 的 scope/action/timingPoint/player/object），层引擎的 conditionMatches 不消费它——程序里的 count subject" +
    "\"controller-xp-gained-this-turn\" 只是描述形状，不构成求值。" +
    "(2)「I have +1 :rb_might:」是 arithmetic 图层的 continuous.might 修正（143.2.a），没有已合入路径把 CardProgram 的 static 能力" +
    "注册成 ContinuousEffectSpec，且层引擎不求值 compare 门槛（RIFT-91 只交付图层引擎）。" +
    "(3)「and [Ganking]」需要 continuous.grant-keyword 持续效果（契约 3.7）；Ganking 的 KeywordDef 已合入，但 zones/movement.ts 与" +
    "effect.move 都不读取该许可（810.1.c/144.4.c），无法证明实际获得 Ganking。依赖：XP 历史谓词路径、RIFT-91 卡牌接线、移动许可消费方。",
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
