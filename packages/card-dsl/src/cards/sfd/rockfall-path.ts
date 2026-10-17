import type { CardProgram } from "../../ir/index.js";

/**
 * Rockfall Path (sfd-216-221) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-216-221):
 *   "Units can't be played here."
 *
 * CR v1.5 anchors:
 * - 054 / 054.1 ("Can't beats Can"): this is a prohibition. It removes a play
 *   destination that other permissions (355.2.b) would otherwise make Valid;
 *   it never grants one.
 * - 355.2 / 355.2.a / 355.2.b: playing a Unit includes choosing a Valid
 *   Location (by default the controller's Base or a Battlefield they control),
 *   and Game Effects may add permitted locations. Those locations become Valid
 *   "for the purposes of Playing the Unit" (355.2.b) — which is exactly the
 *   step a prohibition on this Battlefield has to intercept.
 * - 053.3: Battlefields say "here", so the prohibited destination is this
 *   Battlefield itself.
 *
 * Status: judge-required. RIFT-259 merged the continuous.restrict primitive and
 * the layers/rules query surface, but the prohibition still has no consumer
 * (no approximation is written):
 * - the primitive exists now (effects/instructions/continuous.restrict.ts
 *   registers an ability-layer `{ kind: "restriction", actions, restriction }`
 *   spec, and layers/rules/query.ts exposes `restrictions(registry, action, ...)`),
 *   but nothing calls that query: the Finalize play path
 *   (duel/cardplay-unit-v2.ts) still binds only the actor's own Base as the
 *   entry location (baseLocationId -> board-base) and consults no
 *   Battlefield-level play restriction.
 * - the registration path is a caller-supplied ProgramStaticBinder callback:
 *   programs/statics.ts defaults to noop and no production caller passes a
 *   binder that registers a CardProgram static ability as a ContinuousEffectSpec
 *   (programs/README.md still has no createProgramBinding caller outside tests).
 * - Even with a registration, this card's declared shape is descriptive data,
 *   not the primitive's argument vocabulary: the merged primitive consumes
 *   `mode`/`action`/`appliesTo`/`restriction`, while the declared effect spells
 *   `prohibits`/`cardType`/`location`/`filter` with a `sameLocationAs: "self"`
 *   anchor that programs/filters.ts rejects (Unsupported filter field), so the
 *   prohibition is never silently half-registered.
 * The ability keeps the prohibition shape (card type, prohibited destination,
 * 054.1 semantics) for review; nothing here executes today. Dependencies:
 * RIFT-89 (play/cost plumbing) and the continuous.restrict -> Valid Location
 * consumer (RIFT-91 layers-continuous / the Finalize placement check).
 */
export default {
  canonicalCardId: "card.hash-0bf84d1f197b32b1d70c409fd2d0f0fe59c23923e72f6f7eeb77cb1e4376db7d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Units can't be played here」是 054/054.1 的禁止（355.2/355.2.b 的 Valid Location、053.3 的 here），" +
    "RIFT-259 已合入 continuous.restrict 原语（effects/instructions/continuous.restrict.ts 注册 ability 层 " +
    "{ kind: restriction, actions, restriction }）与 layers/rules/query.ts 的 restrictions() 查询，" +
    "但仍没有消费方，且不近似实现：" +
    "(1) 没有调用者——Finalize 的打出路径（duel/cardplay-unit-v2.ts）仍只把行动者自己的基地作为入场位置" +
    "（baseLocationId → board-base），不查询任何战场级打出禁止；" +
    "(2) 注册路径仍是调用方提供的 ProgramStaticBinder 回调（programs/statics.ts 默认 noop），生产路径没有调用者把 " +
    "CardProgram static 能力注册成 ContinuousEffectSpec（programs/README.md 记录 createProgramBinding 目前只在测试里被调用）；" +
    "(3) 即便注册，本卡声明的形状是描述性数据而非原语参数：原语消费 mode/action/appliesTo/restriction，" +
    "程序里写的是 prohibits/cardType/location/filter 与 sameLocationAs: \"self\" 锚点（programs/filters.ts 对锚点字段以 judge-required 拒绝），" +
    "因此不会被静默半注册。" +
    "依赖：RIFT-89（打出/费用接线）与 continuous.restrict → Valid Location 的消费方（RIFT-91 layers-continuous / Finalize 位置校验）。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        // 054.1: a prohibition only removes the option; it grants no permission.
        restriction: "units-cannot-be-played-here",
        prohibits: true,
        // The prohibited action and the population it applies to (355.2).
        action: "play",
        cardType: "unit",
        // "here" is this Battlefield (053.3); the merged ObjectFilter has no
        // source-battlefield anchor, so the destination is carried as the
        // sibling spelling used by rad/rakelstake and ogn/vilemaws-lair.
        location: "self",
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ],
  sourceText: "Units can't be played here."
} satisfies CardProgram;
