import type { CardProgram } from "../../ir/index.js";

/**
 * Sprite Call (ogn-094-298) — Spell, 3 energy, Mind.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-094-298):
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Play a ready 3 :rb_might: Sprite unit token with [Temporary]. (Kill it at
 *   the start of its controller's Beginning Phase, before scoring.)
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) and [Action] (806) are declared as keyword abilities only.
 *   Hidden's expansion (effects/keywords/Hidden.ts, cost.hidden) grants the
 *   Hide discretionary action and the facedown play permission (RIFT-84);
 *   Action's expansion grants the Showdown permission. The card names both
 *   keywords and nothing more (contract 3.7).
 * - "Play a ready 3 Might Sprite unit token" is a play of a NEW token, which CR
 *   440.2.c/185.2.a resolve by creating it on the Chain and then handing it to
 *   the play flow (420.3/420.3.a). That is exactly effect.token's mode "play"
 *   shape. The Sprite definition itself is printed: 187.2 fixes a 3 Might
 *   domainless unit token with the Fae tag and the Temporary keyword, whose
 *   cost is null (185.3.a: tokens have no costs) — never 0.
 * - "ready" is 143.4's exception: units enter the Board exhausted by default
 *   and only an entry override or effect makes them ready (185.2.d: tokens
 *   follow the rules for their type). The printed word is therefore an entry
 *   stipulation on the creation/play action, not a later effect.ready.
 * - "[Temporary]" is the token's printed keyword (187.2 / 816.1: "At the start
 *   of this permanent's controller's Beginning Phase, before scoring, kill
 *   this"), so it belongs to the token definition rather than to a grant
 *   instruction from this card.
 *
 * Status: judge-required. effect.token resolves the definition id through its
 * frozen table, which deliberately holds only definitions with no additional
 * abilities (recruit, sand-soldier, mech, reflection, tentacle); the Sprite
 * (187.2) is absent because it carries Temporary, and no entry-readiness
 * override is supported ("Entry overrides are not supported"). The Temporary
 * keyword definition itself is merged (effects/keywords/Temporary.ts,
 * RIFT-265), but it only expands the 816.1.b trigger printed on a permanent;
 * it provides neither the Sprite token definition nor the ready entry state,
 * and no merged consumer binds a card program's keyword into a live trigger
 * (RIFT-257). Not approximated: no generic token is substituted for the
 * Sprite, and readiness is not modeled as a follow-up effect.ready.
 */
const spriteCall = {
  canonicalCardId: "card.hash-6f54620dc8f77d546cac09d65f9233740f7ec347a9981fbe6aae3fed0b9f3ef7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Sprite token 定义与 ready 入场支持：CR 187.2 规定 3 Might Sprite 是域外单位 token，带 Fae 标签与 Temporary 关键词，" +
    "费用为 null（185.3.a：token 没有费用，不是 0）；已合入的 effect.token 只在冻结定义表（recruit/sand-soldier/mech/reflection/tentacle）" +
    "中解析定义 id，表中刻意不含带能力的 token，Sprite 因此以 blockedReason \"token-definition-or-abilities-judge-required\" negated；" +
    "同时「ready」是入场状态改写（143.4 默认横置进场、185.2.d token 沿用其类型规则），该动作明确不支持 entry override。" +
    "Temporary 关键词展开已合入（effects/keywords/Temporary.ts，RIFT-265：816.1.b 的 beginning-start kill this），但只展开印在永久物上的关键词触发，" +
    "不提供 token 定义与入场状态，其触发注册也依赖卡牌程序绑定（RIFT-257）。" +
    "[Hidden] 的 Hide 行动与背面打出许可同样缺 cost.hidden 消费路径（811.1.b/811.1.c.2；RIFT-84 已合入 cost.hidden 展开形状，" +
    "消费方与卡牌绑定仍未接通，卡牌程序绑定 RIFT-257）。" +
    "依赖：Sprite 定义与入场就绪支持、RIFT-257。不近似实现：不用其他 token 替代 Sprite，也不用事后 effect.ready 冒充入场就绪。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "sprite-call.play-sprite",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "sprite" },
            amount: { kind: "constant", value: 1 },
            // 440.2.c / 185.2.a: a played token is created on the Chain and
            // handed to the play flow. The Sprite's printed entry state (ready)
            // is part of that flow (143.4 / 185.2.d), not a later effect.
            mode: { kind: "constant", value: "play" },
            entersReady: { kind: "constant", value: true },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            },
            linkKey: { kind: "constant", value: "sprite" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Play a ready 3 :rb_might: Sprite unit token with [Temporary]. " +
    "(Kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default spriteCall;

