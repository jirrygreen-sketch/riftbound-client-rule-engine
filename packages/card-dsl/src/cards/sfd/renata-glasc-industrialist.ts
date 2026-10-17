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
 * Status: judge-required — RIFT-260 merged the replacement binding
 * (`replacement/bind.ts`, `bindReplacement`), so the registration path exists,
 * but it still cannot carry this stipulation (nothing is approximated):
 * - the entry declaration matches only the *host's own* entry: `matchesEnterAction`
 *   requires `action.object.id === hostRef.id`, so it orients this unit as it
 *   resolves, never a token another effect creates.
 * - a general `replacement.event` over the entry cannot see a token being
 *   created either: `replacement/pattern.ts` maps event kinds onto the closed
 *   `GameAction` set (`object-enters-board` -> `move-zone`, plus kill/ready/
 *   exhaust/damage/score/card-played/card-revealed) and `create-token` is not
 *   in that map, so a creation never reaches a replacement matcher. Verified by
 *   binding a replacement whose instead-body banishes the entering object: a
 *   real `move-zone` entry is intercepted, `effect.token` creation is not.
 * - the creation action itself still owns the entry state and supports no
 *   override (effect.token: "Entry overrides are not supported"), and effect.ready
 *   is not an equivalent substitute (143.4 / 805.6: it adds a second state
 *   event instead of replacing the entry, so it can never make the token
 *   "enter ready").
 * The symbolic referent in `with` stays declarative for review: the replaced
 * event's object is bound at plan time as `{ linked: "replacement.object" }`
 * (REPLACED_EVENT_LINK), which a `with` body cannot use while the creation
 * action is not a replaceable event.
 * Dependencies: a replaceable token-creation event (or an entry-orientation
 * override on the creation action) and a CardProgram static/replacement
 * registration consumer in the production path (programs/README.md still has
 * no caller of createProgramBinding outside tests).
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
          // "source" (that is this unit) and NOT backed by a TargetSpec (the
          // token is not a target choice, 355.10.c): no merged selector
          // resolves the object of a replaced event, so the id stays declarative
          // as in the merged Zhonya's Hourglass / The Boss programs.
          objects: {
            kind: "constant",
            value: { kind: "target", id: "renata.entering-token" }
          }
        },
        // Declarative stand-in for the entering token of the replaced event,
        // following the merged Zhonya's Hourglass convention (the object is not
        // a target choice the replacement makes, 355.10.c); the real binding
        // comes from the replaced event once the event-object selector lands.
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
    "「Your tokens enter ready」是入场替代（143.4 / 184.1 / 185.2.d，369.1/369.3）。RIFT-260 已合入替代绑定" +
    "（replacement/bind.ts 的 bindReplacement），但当前仍无载体，且不近似实现：" +
    "(1) replacement.enter 只匹配宿主自己的入场——bind.ts 的 matchesEnterAction 要求 action.object.id === hostRef.id，" +
    "因此只能调整本单位的入场朝向，管不到别的效果创建的 token；" +
    "(2) 通用 replacement.event 也看不到 token 创建：replacement/pattern.ts 的封闭动作映射把 object-enters-board 映到 move-zone，" +
    "create-token 不在其中（实测：instead 体改为放逐入场对象的替代体能拦截真实 move-zone 入场，却拦不住 effect.token 的创建）；" +
    "(3) 创建动作自持入场状态、不支持改写（effect.token 明确记录 “Entry overrides are not supported”），" +
    "事后再 ready 不等价（143.4/805.6：会多一次状态事件，且 token 仍以 exhausted 入场）。" +
    "with 体里的对象指称保持声明式：被替代事件对象在计划期才绑定为 { linked: \"replacement.object\" }（REPLACED_EVENT_LINK），" +
    "在创建动作还不是可替代事件之前无法写进 with。" +
    "依赖：可替代的 token 创建事件（或创建动作上的入场朝向改写）与生产路径上的卡牌 static/replacement 注册消费方" +
    "（programs/README.md 记录 createProgramBinding 目前只在测试里被调用）。",
  abilities,
  sourceText: "Your tokens enter ready."
} satisfies CardProgram;

export default program;
