import type { CardProgram } from "../../ir/index.js";

/**
 * Reaver's Row (ogn-285-298) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-285-298):
 *   "When you defend here, you may move a friendly unit here to base."
 *
 * CR v1.5 anchors:
 * - 383.4.f / 383.4.f.1 / 383.4.f.2.a: "When you defend here …" is a Defend
 *   Trigger (the Defender designation at that Battlefield, 323.2), checked
 *   once per combat; `defense-declared` is the closed timing point.
 * - "you may" makes the ability optional (contract 3.9: wrap the chosen
 *   instructions in `choice.optional` with a body; never choice + linkedTo).
 * - "move … to base" is an effect Move (421 / 451), not the Standard Move, so
 *   no exhaust cost applies; effect.move submits the frozen `move-location`
 *   action with `to: "controller-base"` (the moved unit's controller's Base).
 * - 355.5 / 355.7: "a friendly unit here" names one Game Object, so it is a
 *   target locked while the ability is finalized; "here" is expressed with the
 *   frozen `sameLocationAs: "self"` anchor (contract 3.6).
 *
 * Status: judge-required — two gaps, none approximated:
 * 1. no merged module emits `defense-declared` into the single event pipeline:
 *    the RIFT-281 resweep reconfirmed (commit d8e60ac) that the
 *    attack/defense-declared emitters are still not merged and
 *    combat/flow.ts still throws combat-start-transaction;
 * 2. "here" has no evaluable anchor on the trigger side: the
 *    TargetSpec-side `sameLocationAs: "self"` anchor is merged and really
 *    evaluated (statics.ts / selectors.ts), but the closed EventPattern/
 *    ObjectFilter vocabulary has no battlefield-relative spelling for the
 *    event filter, so it cannot read the host's runtime location id (the
 *    `here: true` key is the documented placeholder);
 * The CardProgram trigger registration is merged; the remaining filter and
 * producer gaps still prevent an honest live trigger. The body only uses merged primitives (choice.optional + effect.move) and is
 * executed by the golden test.
 */
const reaversRow = {
  canonicalCardId: "card.hash-50eea6ceaf8ca3375c963141d772172c81248799d0edc1429deefe6b8b1862e0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) defense-declared 时点（CR 383.4.f.2.a、323.2）仍没有发射方——" +
    "RIFT-281 复核（commit d8e60ac）确认 attack/defense-declared 发射未合入，" +
    "combat/flow.ts 的攻防宣告事务仍显式抛 combat-start-transaction，触发无法进入唯一事件管线；" +
    "(2) 触发侧「here」没有可求值的锚点：TargetSpec 侧 sameLocationAs:\"self\" 已合入并真实求值（statics.ts / selectors.ts），" +
    "但 EventPattern/ObjectFilter 仍没有战场相对词汇读宿主的运行时地点身份，程序里的 here=true 是等待战斗载荷绑定的占位键；" +
    "卡牌程序触发注册本身已合入，但这两个事件/相对锚点缺口仍阻止实时命中。" +
    "能力本体（choice.optional 包裹 effect.move，to: \"controller-base\"）只用已合入原语并有执行测试；整卡保持 judge-required，不近似实现。",
  sourceText: "When you defend here, you may move a friendly unit here to base.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "defense-declared",
        filter: { event: "defense-declared", here: true, player: "controller" }
      },
      // "you may move …": the optional decision is recorded on the ability and
      // the chosen instructions stay inside choice.optional so the interpreter
      // reports acceptance/refusal per contract 3.9.
      optional: true,
      body: [
        {
          id: "reavers-row.move-opt",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Move a friendly unit here to base?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "reavers-row.move",
                  op: "effect.move",
                  args: {
                    objects: { kind: "constant", value: { target: "reavers-row.friendly-here" } },
                    to: { kind: "constant", value: "controller-base" },
                    amount: { kind: "constant", value: 1 }
                  },
                  targets: [
                    {
                      id: "reavers-row.friendly-here",
                      // "a friendly unit here": the frozen ObjectFilter
                      // PlayerSelector spells the ability controller as
                      // "self" (resolved by the chain query), and
                      // sameLocationAs "self" anchors to the source
                      // Battlefield (contract 3.6 / 355.9.b). The older merged
                      // cards use the "controller" placeholder, which no
                      // merged matcher resolves.
                      filter: {
                        type: "unit",
                        zone: "board",
                        controller: "self",
                        sameLocationAs: "self"
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default reaversRow;
