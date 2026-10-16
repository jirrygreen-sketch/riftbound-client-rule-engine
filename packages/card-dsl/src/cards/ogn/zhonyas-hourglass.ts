import type { CardProgram } from "../../ir/index.js";

/**
 * Zhonya's Hourglass (ogn-077-298) — Gear, 2 energy, Calm.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   The next time a friendly unit would die, kill this instead. Recall that
 *   unit exhausted. (Send it to base. This isn't a move.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 811.1 / 811.1.b: [Hidden] is a keyword ability; hiding costs [A] and the
 *   facedown card gains Reaction and ignores its base cost beginning the next
 *   turn. Declared as a keyword ability for the registry to expand.
 * - 369.1 / 370.1.a.1: "The next time a friendly unit would die, kill this
 *   instead" is a Replacement Effect that replaces the killing event; the
 *   replaced event is the death itself (the kill action does not happen).
 * - 457 / 458 / 459 / 460.1: a Recall relocates a permanent to its base
 *   without being a Move; "Recall that unit exhausted" states an exception to
 *   460.1, so the recalled unit's status is set to exhausted as part of the
 *   replacement. 355.10.c: "that unit" refers to the unit intercepted by the
 *   replacement effect, so it is not a new target choice.
 *
 * Status: judge-required — the printed shape is encoded, but neither the
 * activation path nor the recall half is executable with merged code:
 * - "Recall that unit exhausted" needs the recall GameAction (457–460).
 *   effect.move accepts mode "recall" but explicitly BLOCKS it: the frozen
 *   move-location action cannot distinguish a Recall from a Move, and the
 *   primitive refuses to approximate one with the other. Its `objects`
 *   argument also only accepts source/target/pick/choose selectors, and a
 *   target would re-choose the affected unit instead of naming the unit the
 *   replaced event would have killed (355.10.c). The recall step below is
 *   therefore kept as a descriptive, non-executable entry that names the
 *   referent; nothing is approximated.
 * - A Replacement Effect declared on a card has no merged registration path:
 *   the event/chain layer (RIFT-120) registers replacements as action
 *   matchers with a `with`-body, but nothing binds the intercepted unit
 *   ("that unit") into the replacement body, and the printed "the next time"
 *   one-shot lifetime is not wired to a card program.
 * The kill-this half is fully described and executed in isolation by the
 * golden test; the recall half is judged, not approximated.
 */
const zhonyasHourglass = {
  canonicalCardId: "card.hash-876fbb11303be19701acffe6831c8d2c74d73130b38f29962ed2cef06bc76387",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Recall 动作：effect.move 的 mode \"recall\" 被原语显式阻断（封闭 move-location 动作" +
    "无法区分 Recall 与 Move，CR v1.5 457–460），不能近似为普通移动；" +
    "卡牌级替代效果（369.1/370.1.a.1）没有已合入的注册路径：事件/链层（RIFT-120）" +
    "尚未把卡牌程序的 replaces/with 转成动作匹配器，也没有把被替代死亡的单位绑定进" +
    "替代体（\"that unit\"）；印刷的 \"the next time\" 一次性期限同样未接线。" +
    "kill this 部分仅用已合入的 effect.kill(self) 并由 golden 执行；不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "replacement",
      // "The next time a friendly unit would die" — the replaced event is the
      // death of a unit the controller controls.
      replaces: {
        event: "object-killed",
        filter: { type: "unit", controller: "self" }
      },
      with: [
        {
          // "kill this instead" — the replacement kills the source gear.
          id: "kill-this",
          op: "effect.kill",
          args: { self: { kind: "constant", value: true } }
        },
        {
          // "Recall that unit exhausted." The intercepted unit is referenced
          // only symbolically; binding it from the replaced event is the
          // judged part (see judgeReason).
          id: "recall-dying-unit",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "dying-unit" } },
            to: { kind: "constant", value: "controller-base" },
            mode: { kind: "constant", value: "recall" }
          },
          targets: [
            {
              id: "dying-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 460.1 exception stated by this card: the recalled unit is
          // exhausted (the status change belongs to the recall, not to a Move).
          // "that unit" is the same referent the recall names (355.10.c), so it
          // reads the target group declared by the recall instruction instead
          // of choosing a second unit.
          id: "exhaust-dying-unit",
          op: "effect.exhaust",
          args: { target: { kind: "constant", value: "dying-unit" } },
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "The next time a friendly unit would die, kill this instead. Recall that unit exhausted. (Send it to base. This isn't a move.)"
} satisfies CardProgram;

export default zhonyasHourglass;
