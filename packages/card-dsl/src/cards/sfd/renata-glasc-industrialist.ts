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
 * binding and replacement.object exist; the body uses that non-target binding.
 * Cross-object entry orientation and create-token interception remain blocked.
 * The static entry detector only accepts self/source and rejects this linked
 * body during binding; cross-object orientation must preserve the entry move.
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
          // 355.10.c: bind the intercepted token without choosing a target.
          // "source" would refer to Renata, not the entering token.
          objects: {
            kind: "constant",
            value: { linked: "replacement.object" }
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-f24db41d4c6576e3cd77510e93f4c384bab9ccb151eba3ce9a3666b6862b79d3",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺跨对象 token 入场朝向替代（CR v1.5 143.4/184.1/185.2.d/369.3/805.6）：" +
    "replacement.enter 已合入，但 matchesEnterAction 仅处理宿主自己的 chain→board move-zone；" +
    "本卡已用非目标 replacement.object 表达进入的 token，规划器可解析，但 bindReplacement 的静态入场识别仅接受 self/source，" +
    "绑定时抛 Unsupported entry body target value；缺跨对象入场朝向及原 move-zone 动作保留。object-enters-board 映射也没有 create-token，" +
    "TokenSpec/create-token/play 不提供入场朝向覆盖（Entry overrides are not supported）。" +
    "依赖：跨对象入场朝向与原入场动作保留、可拦截的 create-token 入口；事后就绪不等价。",
  abilities,
  sourceText: "Your tokens enter ready."
} satisfies CardProgram;

export default program;
