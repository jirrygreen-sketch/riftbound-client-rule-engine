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
 * Status: judge-required — three gaps, none approximated:
 * 1. no merged module emits `defense-declared` into the single event pipeline:
 *    combat/flow.ts still throws combat-start-transaction and the RIFT-270
 *    producer audit lists attack/defense-declared as 待后续;
 * 2. "here" has no evaluable anchor: the closed EventPattern/ObjectFilter
 *    vocabulary has no battlefield-relative spelling, so the static filter
 *    cannot read its host's runtime location id (the `here: true` key is the
 *    documented placeholder);
 * 3. no merged subscriber turns a CardProgram's triggered ability into a live
 *    TriggerRegistration (card-program binding, RIFT-257).
 * The body only uses merged primitives (choice.optional + effect.move) and is
 * executed by the golden test.
 */
const reaversRow = {
  canonicalCardId: "card.hash-50eea6ceaf8ca3375c963141d772172c81248799d0edc1429deefe6b8b1862e0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) defense-declared 时点（CR 383.4.f.2.a、323.2）仍没有发射方——combat/flow.ts 的攻防宣告事务未实现" +
    "（显式抛 combat-start-transaction），RIFT-270 审计也把 attack/defense-declared 标为待后续，触发无法进入唯一事件管线；" +
    "(2)「here」没有可求值的锚点：EventPattern/ObjectFilter 没有战场相对词汇，静态 filter 读不到宿主的运行时地点身份，" +
    "程序里的 here=true 是等待战斗载荷绑定的占位键；(3) 没有消费方把卡牌的 triggered ability 注册成实时触发（卡牌程序绑定 RIFT-257）。" +
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
