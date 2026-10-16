import type { CardProgram } from "../../ir/index.js";

/**
 * Targon's Peak (ogn-289-298) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-289-298):
 *   "When you conquer here, ready 2 runes at the end of this turn."
 *
 * CR v1.5 anchors:
 * - 383.4.c / 383.4.c.1: "When you conquer here …" is a Conquer Effect (the
 *   closed `conquer` timing point, 468.5.d / 471.1 / 473.2.a).
 * - 391.2 / 382: "ready … at the end of this turn" is a Delayed Trigger — a
 *   Triggered Ability with a specific frame of time as its restriction, not an
 *   instruction resolved immediately.
 * - 355.5.b names this exact card: the choices involved are not made when
 *   finalizing the conquer effect but when finalizing the resulting delayed
 *   trigger at the end of the turn.
 * - 416.1: readying a rune readies it; effect.ready is the merged primitive
 *   for the action, and 417.1.b / 108.5 place runes in the Rune Zone.
 *
 * Status: judge-required — three merged gaps, none approximated:
 * 1. no merged module emits the `conquer` timing point into the single event
 *    pipeline, so the outer trigger cannot enter the chain;
 * 2. no merged primitive registers a delayed trigger with an expiry window:
 *    RIFT-9's primitive list names `trigger.delayed` and ResolveContext has
 *    `registerDelayedTrigger(at, body)` for engine internals, but the
 *    instruction registry has no opcode that consumes it
 *    (chain/README.md §契约变更请求 3 records the missing window/expiry
 *    information), so "at the end of this turn" cannot be expressed and the
 *    readying must not happen during the conquer resolution (355.5.b);
 * 3. the ready's choices belong to the delayed trigger's finalize, which needs
 *    the interpreter lifecycle interface the chain layer also has not merged.
 * The body records the two printed parameters (2 runes, at the end of this
 * turn) for review; it is not executable data.
 */
const targonsPeak = {
  canonicalCardId: "card.hash-443bbd81ca54ffdeed5341da932702bf2c62ea4d20d8be07b4fbfc36c4340493",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) conquer 时点（CR 471.1、473.2.a）没有被任何已合入模块 emit 进唯一事件管线，" +
    "外层触发无法进链（需 scoring/触发接线，RIFT-31/RIFT-33 及契约 §7.2 批 5）；" +
    "(2) 缺 RIFT-9 清单中的 trigger.delayed 延迟触发注册原语：CR 391.2/355.5.b 要求把 ready 2 runes 作为" +
    "本回合结束时的延迟触发，且选择在该延迟触发 finalize 时才做出，但 effects/instructions/ 没有任何 opcode " +
    "消费 ResolveContext.registerDelayedTrigger，chain/README.md 契约变更请求 3 亦记录延迟窗口/期限信息缺失，" +
    "无法表达 “at the end of this turn”；(3) 延迟触发的目标选择需要解释器生命周期接口（chain README " +
    "契约变更请求 2），尚未合入。程序仅记录 2 runes 与本回合结束时两个印刷参数，不近似实现。",
  sourceText: "When you conquer here, ready 2 runes at the end of this turn.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "targons-peak.ready-2-runes",
          // Unregistered placeholder for RIFT-9's trigger.delayed primitive:
          // registering the end-of-turn delayed trigger has no merged
          // implementation (see judgeReason).
          op: "trigger.delayed",
          args: {
            at: { kind: "constant", value: "turn-end" },
            window: { kind: "constant", value: "this-turn" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "targons-peak.ready",
                  op: "effect.ready",
                  args: {
                    // Non-target pick descriptor (merged effect.ready spelling;
                    // sfd/veiled-temple.ts precedent): the runes are chosen when
                    // the delayed trigger is finalized (355.5.b), never while the
                    // conquer effect resolves.
                    objects: { kind: "constant", value: { kind: "pick", id: "targons-peak.runes" } },
                    amount: { kind: "constant", value: 2 }
                  },
                  picks: [
                    {
                      id: "targons-peak.runes",
                      options: ["controller-runes"],
                      filter: { type: "rune", zone: "rune-zone", controller: "self" },
                      min: 1,
                      max: 2,
                      selection: "up-to"
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

export default targonsPeak;
