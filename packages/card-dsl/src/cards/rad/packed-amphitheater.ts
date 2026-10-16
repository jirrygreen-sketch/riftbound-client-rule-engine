import type { CardProgram } from "../../ir/index.js";

/**
 * Packed Amphitheater (rad-164-167) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-164-167):
 *   "Champion units here have +1 :rb_might:."
 *
 * CR v1.5 anchors:
 * - 133.7.a: Champion is a supertype that applies exclusively to units; a
 *   "Champion unit" is a Unit printing carrying the Champion marker (in the
 *   catalog the Unit's tags include "Champion", and the server's trusted
 *   catalog type resolver returns the "Champion" printing kind for it).
 * - 475 / 476 / 479: "have" is a Layer effect that alters a property of the
 *   Game Objects; the arithmetic Might increase is the Arithmetic layer
 *   (479.4 / 479.4.e.1 applies positive increases first).
 * - 478.1 / 190.6.a: the effect is evaluated continuously while the Battlefield
 *   is in use; control of the Battlefield determines control of its abilities.
 * - 053.3: "here" is this Battlefield, so the unit must be at this Battlefield;
 *   740.1.a: this includes attackers (Combat does not remove the unit from the
 *   location).
 *
 * Status (cards/README.md §2): judge-required. The merged layers engine really
 * performs the arithmetic (the golden test evaluates continuous.might with
 * mode add and observes Might 3 → 4), but the card is not executable because
 * its ability can never be registered as written:
 * 1. no merged path turns a CardProgram's static ability into a
 *    ContinuousEffectSpec registered with LayerEngine: registerContinuousEffect
 *    has no caller and engine-core never reads card-program abilities (the same
 *    gap sfd/rumble-scrapper and ogn/trifarian-war-camp record). A card file
 *    cannot register its own effect at runtime.
 * 2. the "here" scope anchor is not honored by the merged object filter:
 *    layers/filter.ts matchesObjectFilter implements objectId/cardId/type/zone/
 *    location/controller/owner/state/tags/characteristics but no sameLocationAs,
 *    so the declared filter would add +1 Might to Champion units at every
 *    Battlefield. The golden test demonstrates exactly that over-application,
 *    which is why the card must not be marked executable.
 * 3. the Champion predicate depends on the object's traits carrying the
 *    Champion marker (133.7.a); the catalog knows the printing kind, but no
 *    merged snapshot producer is proven to put it into ObjectSnapshot.types for
 *    a unit on the board (tokens and carriers only model 'unit'/'gear'/...).
 * Dependencies: the RIFT-91 follow-up that registers card-program static
 * abilities and implements the sameLocationAs/here filter anchor, plus the
 * champion-marker trait mapping.
 */
export default {
  canonicalCardId: "card.hash-7e95acea2b29696bcdb29e7def854dacdbb55f72f5160fb4bc3e9c872950af6e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 没有已合入路径把 CardProgram 的 static 能力注册成 layers/LayerEngine 的 ContinuousEffectSpec：" +
    "registerContinuousEffect 没有调用方，engine-core 源码从不读取卡牌程序能力，卡牌文件无法在运行时自行注册（同 sfd/rumble-scrapper、ogn/trifarian-war-camp）。" +
    "(2) 「here」锚点未被已合入过滤器支持：layers/filter.ts 的 matchesObjectFilter 实现了 objectId/cardId/type/zone/location/controller/owner/state/tags/characteristics，" +
    "但没有 sameLocationAs，声明中的 filter 会把 +1 Might 加到所有战场上的 Champion 单位（golden 用真实 LayerEngine 复现了这一过度应用）。" +
    "(3) Champion 谓词依赖对象特征携带 Champion 标记（133.7.a）：目录与服务器 trusted type resolver 知道印刷类型，但没有任何已合入快照生产者被证明把该标记写进 Board 单位的 ObjectSnapshot.types。" +
    "层算术本身已合入（479.4 arithmetic 层、479.4.e.1 正增加先算），golden 已真实执行 Might 3→4；依赖：RIFT-91 后续的卡牌 static 注册与 sameLocationAs/here 过滤器锚点、champion 标记特征映射。不近似实现。",
  sourceText: "Champion units here have +1 :rb_might:.",
  abilities: [
    {
      kind: "static",
      effect: {
        // 479.4 / 479.4.e.1: +1 Might is an arithmetic-layer addition; the
        // merged LayerEngine consumes exactly this shape (the golden test runs
        // it). filter.type "champion" is the 133.7.a supertype predicate, and
        // sameLocationAs "self" carries the 053.3 "here" referent, which the
        // merged filter does not implement (see judgeReason).
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        filter: {
          type: "champion",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;

