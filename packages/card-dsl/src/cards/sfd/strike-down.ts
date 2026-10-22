/**
 * Strike Down (sfd-107-221) — Spell, 3 energy + 1 Body power, Fiora deck.
 *
 * Printed text:
 *   Choose an equipped friendly unit. It deals damage equal to its Might to an
 *   enemy unit. Then detach an Equipment from it.
 *
 * Official source: Core Rules v1.5 (last updated 2026-10-09, effective
 * 2026-10-16 for the current profile):
 *   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
 *
 * Rules model:
 * - "Choose an equipped friendly unit" names a public Board object and is a
 *   target under CR 355.5, 355.7 and 355.8. CR 359.3.e.12's official Strike
 *   Down example also calls this object the spell's "targeted unit". Both the
 *   equipped friendly unit and the enemy unit are therefore TargetSpecs locked
 *   during Finalize; modelling the first choice as a non-target pick would lose
 *   the legal-target retest and linked-instruction semantics.
 * - "It deals damage equal to its Might" uses the friendly unit as the Deal's
 *   source and reads its current Might on Resolve (CR 418.6.b.3).
 * - "Then detach an Equipment from it" is linked to the damage instruction
 *   (CR 359.3.e.14). The Equipment is a Gear with the Equipment tag (CR 150.1,
 *   818.1.a), restricted to an object Attached to the locked friendly unit
 *   (CR 718.5; Detach itself does not inherently target, CR 436.3).
 *
 * Status: judge-required (2026-10-21 replay against current integration).
 *
 * - "equipped": the shared ObjectFilter has an `attachedTo` anchor, but its
 *   consumer compares the candidate's own `attachedTo` to another object; it
 *   cannot ask whether a Unit hosts an attached Equipment. `states:"attached"`
 *   likewise means that the candidate itself is attached, not that the
 *   candidate is equipped (CR 818.3.b). There is no inverse attachment
 *   predicate.
 * - The Equipment pick does have a production producer in the current
 *   integration: chain/picks/linked.ts resolves a filter-driven pick on Resolve,
 *   prompts through the authoritative host, applies the filter and bounds,
 *   caches the answer for retries, and exposes it through ResolveContext.picks.
 *   A probe with only the unsupported `equipped` target predicate removed
 *   reached that prompt and completed damage plus detach. The Equipment pick is
 *   therefore retained as the real printed choice, but it is no longer listed
 *   as a separate engine blocker.
 *
 * The program keeps both restrictions explicit. Dropping `equipped` would
 * widen the first target, and using `eachAttachedTo` would detach every
 * attachment instead of one chosen Equipment. No inferred replacement is used.
 *
 * Speed: no [Action]/[Reaction] keyword appears on the printing, so default
 * spell timing (CR 159.2) applies.
 */
const strikeDown = {
  canonicalCardId: "card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前生产路径不能执行整卡（2026-10-21 按 CR v1.5 复核）。「Choose an equipped friendly unit」按 355.5/355.7/355.8 是目标；" +
    "359.3.e.12 的官方 Strike Down 示例也明确称其为 targeted unit。程序已把 equipped friendly unit 和 enemy unit 都写成 TargetSpec，" +
    "damage 的 amount/source 读取宿主 target。剩余缺口：(1) ObjectFilter 没有反向 equipped 谓词，无法判断一个 Unit 是否 Attached 着带 " +
    "Equipment 标签的 Gear（818.3.b）：programs/filters.ts:124 会 fail closed 拒绝 equipped，effects/interpreter/selectors.ts:175-176 的 " +
    "attachedTo 与 effects/filters/predicates.ts:142-160 的 states:attached 都只检查候选对象自身，不能替代宿主条件。" +
    "该目标条件的缺失就是当前唯一已知的整卡生产阻塞。其余路径已实测：equipped 条件移除后的近可执行探针由真实 ChainEngine 在两个 target " +
    "Finalize 后，于 Resolve 通过 chain/picks/linked.ts:80-193 请求并锁定 filter-driven detach pick，最终造成 4 点伤害、detach Equipment、" +
    "支付 3 Energy + 1 Body 并清空链；这不是整卡证据，因为探针删除了印刷限制。因此首发 Select/过滤及任何依赖它的卡须等 equipped 生产者。",
  sourceText:
    "Choose an equipped friendly unit. It deals damage equal to its Might to an enemy unit. Then detach an Equipment from it.",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // Finalize chooses both targets: "an equipped friendly unit" and
          // "an enemy unit" (355.5/355.7/355.8). The damage source and amount
          // refer back to the former, rather than choosing it again.
          id: "damage",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-attribute",
              object: { target: "equipped-friendly-unit" },
              attribute: "might"
            },
            source: {
              kind: "object-attribute",
              object: { target: "equipped-friendly-unit" },
              attribute: "ref"
            },
            target: { kind: "constant", value: "enemy-unit" }
          },
          targets: [
            {
              id: "equipped-friendly-unit",
              // `equipped` remains an explicit, reviewable restriction. The
              // production translator rejects it instead of silently widening
              // the target set; see judgeReason (1).
              filter: { type: "unit", zone: "board", controller: "you", equipped: true },
              min: 1,
              max: 1,
              selection: "one"
            },
            {
              id: "enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // The singular Equipment is chosen from the locked host's
          // attachments. It stays a pick because Detach does not inherently
          // choose or target (436.3). The current production pick resolver can
          // drive this choice once the host target itself can be finalized.
          id: "detach",
          op: "effect.detach",
          args: { pick: { kind: "literal", value: "detached-equipment" } },
          picks: [
            {
              id: "detached-equipment",
              options: ["dynamic:attached-equipment"],
              selection: "one",
              min: 1,
              max: 1,
              filter: {
                type: "gear",
                tags: "Equipment",
                zone: "board",
                attachedTo: { target: "equipped-friendly-unit" }
              }
            }
          ],
          linkedTo: "damage"
        }
      ]
    }
  ]
};

export default strikeDown;
