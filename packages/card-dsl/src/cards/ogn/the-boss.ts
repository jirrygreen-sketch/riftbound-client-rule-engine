import type { CardProgram } from "../../ir/index.js";

/**
 * The Boss (ogn-269-298) — Legend, Body/Order, tag Sett.
 *
 * Printed text:
 *   When a buffed unit you control would die, you may pay :rb_rune_rainbow:
 *   and exhaust me to spend its buff and recall it exhausted instead. (Send it
 *   to base. This isn't a move.)
 *   When you conquer, ready me.
 *
 * Structure (contract 3.1/3.2):
 * - ability 1 is a replacement ability over the death of a buffed friendly
 *   unit (CR 380/381 define Replacement Effects; the object being replaced is
 *   the unit, so the object is part of the replacement condition and is not a
 *   target choice, CR 355.10.c); the `with` body performs the printed costs and
 *   remedy: pay [A], exhaust me, spend its Buff (CR 702.2.b: remove one Buff
 *   counter) and recall it to base (CR 457: a Recall is not a Move, 458.1: it
 *   does not trigger Move triggers, 460.1: it does not otherwise change the
 *   permanent's state, so the printed "exhausted" is applied explicitly);
 * - ability 2 is a Conquer Effect (CR 383.4.c/383.4.c.2.b): trigger on the
 *   conquer timing point when this legend's controller conquers, body is the
 *   merged effect.ready primitive with the default `"source"` selector ("ready
 *   me", 412.4/416.1).
 *
 * Status: judge-required. Ability 2 is expressible and has execution tests.
 * Ability 1 now binds the replaced event's object through the merged RIFT-260
 * binding (`{ linked: "replacement.object" }`, contract 3.6), but still cannot
 * register or run:
 * - `cost.pay` (rainbow + exhaust as a completable cost, CR 415.4/415.5) is a
 *   RIFT-261 instruction with no merged file; `bindReplacement` rejects it at
 *   bind time as an unsupported planned opcode, so the replacement stays
 *   unbindable no matter how the rest of the body is spelled;
 * - the "you may pay ... instead" decision now has a merged home in RIFT-260's
 *   `replacement.event { optional }`, but a card program cannot spell that
 *   wrapper's `instead` instruction body in the frozen IR (validateInstruction
 *   accepts only Expr args while the binding layer requires a raw instruction
 *   array), so the may-decision is recorded here; see the contract change
 *   request;
 * - `effect.move` explicitly blocks its recall mode: "Recall requires an action
 *   distinct from Move (CR 457-460)" and submits no substitute Move;
 * - a "buffed unit you control" (CR 702.2.a: a unit with a Buff counter) has no
 *   predicate in the EventPattern/ObjectFilter vocabulary or the replacement
 *   matchers (`replacement/pattern.ts` normalizes unknown keys away), so the
 *   declared `buffed: true` filter would over-match; it is intent data only;
 * - no merged consumer turns a CardProgram's replacement ability into a
 *   ReplacementRegistration (RIFT-257, in progress).
 * The contract's ZoneId also has no Legend Zone (CR 108.3); the cost pipeline's
 * "exhaust me" payment stays recorded in the contract-change request.
 */
const program = {
  canonicalCardId:
    "card.hash-867768d6facbba96eedbdea3f89369bd9565961dca92d203a6b67e05e879947f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "能力 1（死亡替代）当前缺件：① cost.pay（rainbow + 作为可完成费用的横置，CR 415.4/415.5）是 RIFT-261 指令，未合入；" +
    "replacement 绑定层会在 bind 时把 cost.pay 判为不受支持的 planned opcode 并抛 BlockedReplacementError，因此整条替代无法注册；" +
    "② “you may pay ... instead” 的决策在 RIFT-260 的 replacement.event { optional } 已有位置，但卡牌侧无法在冻结 IR 里拼写该 wrapper 的 instead 指令体" +
    "（validateInstruction 只接受 Expr 参数，绑定层要求原始指令数组），见契约变更请求；" +
    "③ effect.move 的 recall 模式仍被显式阻断（Recall 是与 Move 不同的动作，CR 457-460，封闭 GameAction 集合没有对应动作）；" +
    "④ “buffed 单位”（CR 702.2.a：身上有 Buff 计数）在 EventPattern/ObjectFilter 词汇与替代匹配器（replacement/pattern.ts 会把未知键归一化掉）中都没有谓词，" +
    "replaces.filter 的 buffed: true 只是意图声明，注册后会过度匹配；⑤ 没有已合入消费方把 CardProgram 的替代能力注册成 ReplacementRegistration（RIFT-257 进行中）。" +
    "已合入并已改写：被替代事件对象用契约 3.6 的 { linked: \"replacement.object\" }（RIFT-260 的 REPLACED_EVENT_LINK），with 体的 buff/move/exhaust 选择符与替代 planner 形状一致。" +
    "能力 2（When you conquer, ready me）用已合入的 effect.ready 与 conquer 时点，有真实执行测试；整卡因能力 1 保持 judge-required。" +
    "依赖：RIFT-261（cost.pay/cost.modify）、RIFT-257（CardProgram 替代绑定）、CR 457-460 的 Recall 动作与 CR 702.2.a 的 buffed 谓词（契约变更请求）。",
  abilities: [
    {
      kind: "replacement",
      replaces: {
        event: "object-killed",
        filter: {
          type: "unit",
          // Engine PlayerSelector vocabulary (events/trigger-spec.ts): "self"
          // means the ability controller, i.e. "a unit you control".
          controller: "self",
          // "buffed" (CR 702.2.a: a unit with a Buff counter) has no merged
          // predicate field in either EventPattern/ObjectFilter vocabulary; it
          // is recorded here for the replacement pipeline work named in
          // judgeReason and is never treated as true by accident.
          buffed: true
        }
      },
      with: [
        {
          id: "the-boss.pay",
          op: "cost.pay",
          args: {
            // "pay :rb_rune_rainbow: and exhaust me": the exhaust is a cost
            // (CR 415.4/415.5), binding the source legend implicitly; the
            // finalized payment plan is owned by the cost pipeline (RIFT-261).
            power: { kind: "constant", value: ["rainbow"] },
            payments: { kind: "constant", value: [{ kind: "exhaust" }] }
          }
        },
        {
          id: "the-boss.spend-buff",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "spend" },
            // "its buff" = the replaced event's unit, bound through the merged
            // RIFT-260 selector (contract 3.6 linked form). The unit is not a
            // target (CR 355.10.c), so no TargetSpec backs this id.
            target: { kind: "constant", value: { linked: "replacement.object" } }
          },
          linkedTo: "the-boss.pay"
        },
        {
          id: "the-boss.recall",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { linked: "replacement.object" } },
            to: { kind: "constant", value: "controller-base" },
            mode: { kind: "constant", value: "recall" }
          },
          linkedTo: "the-boss.spend-buff"
        },
        {
          id: "the-boss.exhaust-recalled",
          op: "effect.exhaust",
          args: {
            // "recall it exhausted": Recalls do not change statuses (CR 460.1),
            // so the exhausted state is applied explicitly after the recall.
            objects: { kind: "constant", value: { linked: "replacement.object" } }
          },
          linkedTo: "the-boss.recall"
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // "When you conquer": the Conquer Effect of anything that references
        // the player Conquering (CR 383.4.c.2.b). PlayerSelector "self" means
        // "the trigger controller performed the action" in the frozen
        // TriggerSpec vocabulary (events/trigger-spec.ts); this legend's
        // controller is the conqueror. "controller" is not a valid
        // PlayerSelector and is not used here.
        filter: { event: "conquer", player: "self" }
      },
      optional: false,
      body: [{ id: "the-boss.ready", op: "effect.ready", args: {} }]
    }
  ],
  sourceText:
    "When a buffed unit you control would die, you may pay :rb_rune_rainbow: and exhaust me to spend its buff and recall it exhausted instead. (Send it to base. This isn't a move.)\n" +
    "When you conquer, ready me."
} satisfies CardProgram;

export default program;
