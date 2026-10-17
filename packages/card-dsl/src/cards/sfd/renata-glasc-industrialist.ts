import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Renata Glasc, Industrialist (sfd-171-221) — Unit, 4 energy + 1 Order power,
 * Might 4, tags Renata Glasc / Zaun / Champion.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-171-221):
 *   Your tokens enter ready.
 *
 * Rules evidence (Core Rules v1.5):
 * - 143.4: units enter the Board exhausted; 184.1 / 185.2.d let a creating
 *   effect state that a token enters ready when that is contrary to the
 *   default for its type. 805.6 makes the same point for Accelerate: the token
 *   "does not enter exhausted and then become ready", so the stipulation must
 *   replace the entry state, not add a later readying.
 * - 369.1 / 369.3: an ability describing how a permanent enters the board is a
 *   Replacement Effect over the entry event ("I enter ready" is the quoted
 *   example). The shape below follows the merged Accelerate expansion
 *   (effects/keywords/Accelerate.ts): a replacement over object-enters-board
 *   whose body readies the entering object.
 * - 182/183: a token's controller is the controller of the effect that created
 *   it, so "your tokens" is the ability controller's tokens.
 *
 * Current review:
 * CR v1.5 143.4/184.1/185.2.d and 369.1/369.3: entering ready is an
 * entry replacement, not a later Ready action (805.6). Default replacement
 * binding and replacement.object exist; cross-object token entry orientation
 * remains blocked. The with body is declarative pending that adapter.
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { type: "token", controller: "self" }
    },
    with: [
      {
        id: "renata.tokens-enter-ready",
        op: "effect.ready",
        args: {
          // Names the entering token of the replaced event. Deliberately NOT
          // "source" (that is this unit). This remains a blocked placeholder:
          // 355.10.c requires a non-target replacement.object binding once
          // cross-object token entry replacement is supported.
          objects: {
            kind: "constant",
            value: { kind: "target", id: "renata.entering-token" }
          }
        },
        // Declarative stand-in for the entering token of the replaced event,
        // following the merged Zhonya's Hourglass convention (the object is not
        // a target choice the replacement makes, 355.10.c); the real binding
        // must use replacement.object once token entry rewriting is supported.
        targets: [
          {
            id: "renata.entering-token",
            filter: { type: "token", controller: "controller" },
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
  canonicalCardId: "card.hash-f24db41d4c6576e3cd77510e93f4c384bab9ccb151eba3ce9a3666b6862b79d3",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Your tokens enter ready」缺跨对象的 token 入场朝向替代（CR v1.5 143.4/184.1/185.2.d、369.1/369.3、805.6）：replacement.enter 的 matchesEnterAction 只处理宿主自己的 move-zone 入场，replacement.event 的 object-enters-board 映射也只有 move-zone、没有 create-token；effect.token 的创建动作不提供朝向改写（Entry overrides are not supported）。被替代对象已有 replacement.object 链接，但当前 with 中的 TargetSpec 不能代替非目标的入场对象绑定。依赖：可替代的 create-token/后续 token 入场动作及跨对象入场状态改写；事后 effect.ready 会增加状态事件，不等价。",
  abilities,
  sourceText: "Your tokens enter ready."
} satisfies CardProgram;

export default program;
