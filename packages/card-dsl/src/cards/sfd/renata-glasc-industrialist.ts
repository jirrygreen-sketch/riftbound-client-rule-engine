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
 * Status: judge-required — the entry stipulation has no merged carrier and
 * nothing is approximated:
 * - the frozen create-token/play actions own the entry state and support no
 *   override; effect.token documents "Entry overrides are not supported", and
 *   effect.exhaust explains that readying later is not equivalent (it adds a
 *   second state event and misses entry replacement, 143.4 / 805.6).
 * - the replacement.enter family (the survey records 71 identities) has no
 *   merged implementation: the event pipeline (RIFT-120) registers
 *   replacements as action matchers, but no code turns a card program's
 *   ReplacementAbility into a registration, and the merged "with" body has no
 *   ObjectSelector for the entering object of the replaced event ("source"
 *   would name this unit, not the token being created).
 * Dependencies: replacement.enter + card-program replacement registration
 * (engine batch 4/5) and a token-entry override in the creation action.
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
    "「Your tokens enter ready」是入场替代（143.4 / 184.1 / 185.2.d，369.1/369.3）：封闭的 create-token/play 动作自持入场状态、" +
    "不支持改写（effect.token 明确记录 “Entry overrides are not supported”）；effect.exhaust 又说明事后重置不等价" +
    "（会多一次状态事件并错过 143.4/805.6 的入场替代）。replacement.enter 族（调研 71 个身份）没有已合入实现：" +
    "事件管线（RIFT-120）以动作匹配器注册替代体，但没有把卡牌程序的 replacement 转成注册，with 体也没有指向“被替代事件对象”的选择符。" +
    "故按 Accelerate 展开的既有形状保留 replacement（entry → ready 该对象），不近似实现、不用事后 ready 冒充。依赖：replacement.enter 与卡牌替代注册（引擎批 4/5）、token 入场状态改写。",
  abilities,
  sourceText: "Your tokens enter ready."
} satisfies CardProgram;

export default program;
