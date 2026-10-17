import type { CardProgram } from "../../ir/index.js";

/**
 * Star Spring (unl-215-219) — Battlefield, Colorless.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-215-219, verbatim):
 *   "The first time a player plays a non-token unit here each turn, they may
 *    move another unit they control here to its base."
 *
 * CR v1.5 anchors:
 * - 383.1 / 383.1.b: "The first time a player plays … each turn" names a
 *   Triggered Ability with a per-turn frequency; when the condition is met
 *   several times at once only one instance serves as the trigger.
 * - 383.4.a / 383.4.a.4 / 359 / 407: playing a card is the game action that
 *   puts it on the chain; "a player plays a non-token unit here" is that event
 *   restricted to this Battlefield and to a unit that is not a token (185.1
 *   keeps tokens a separate object kind).
 * - 190.6.c: the text names "a player" and "they", so the player who played
 *   the unit — not the Battlefield's controller — makes the choices and
 *   controls the ability.
 * - 144.4.b / 448.1 / 449: "move … to its base" is a Move whose destination is
 *   the moved unit's own Base (451); 457's Recall is not what the card says, so
 *   effect.move's "controller-base" form is used rather than a recall.
 * - 355.7 / 355.9.a.1 / 355.10: "another unit they control here" is one unit
 *   they choose, so it is a target; "another" excludes the unit that was just
 *   played, and "here" restricts it to this Battlefield and to that player's
 *   control (740.1.a). 355.12 treats every choice for the "may" action as
 *   targeted and chosen independently of the decision, so the TargetSpec hangs
 *   on the optional wrapper (the merged salvage / guardian-of-the-passage
 *   spelling) rather than inside the Move instruction.
 * - 403.1 / contract §3.9: "they may …" is a resolution-time optional
 *   decision written as `choice.optional` with the chosen instruction in its
 *   body.
 *
 * Status (packages/card-dsl/src/cards/README.md §2): judge-required — the
 * optional wrapper and the Move are both merged primitives and the golden test
 * executes the printed move through the real interpreter with the target and
 * destination bound, but the card cannot run as printed:
 * 1. "they" is an event participant (190.6.c). No frozen selector or Expr
 *    reads the triggering event's player, so neither the chooser nor the
 *    "unit they control here" owner restriction can be bound; the target
 *    filter keeps a documented placeholder for that player instead of
 *    silently substituting the Battlefield's controller (same gap
 *    rad/rakelstake records);
 * 2. "the first time … each turn" is per-player, turn-scoped and restricted to
 *    plays at this Battlefield. TriggerSpec.once scopes (per-turn/per-combat/
 *    per-chain/per-game) are keyed to one registration + source rather than to
 *    each event player, and the closed card-played payload does not expose the
 *    play's destination Battlefield, so neither the frequency nor the "here"
 *    restriction can be evaluated (the filter keys below are documented
 *    placeholders);
 * 3. CardProgram trigger registration is merged, but this declaration still cannot be translated because
 *    the event-player selector, per-player once key, and card-played destination/non-token payload are not
 *    present in the frozen event contract. Nothing is approximated.
 * Dependencies: event-player selector, per-player once frequency, and play-location/non-token payload
 * (contract change requests; location workstream RIFT-357).
 */
export default {
  canonicalCardId:
    "card.hash-947f958ba5d9376078dbb3ffcb143e3e833bc4d2ed24f6d6bb472e1c5d8f256b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「they」是事件的参与者（打出该单位的玩家，190.6.c）：冻结 IR 没有事件玩家选择器，" +
    "ObjectSelector/Expr 都读不到触发事件的 player，因此选择者与「they control」的归属都无法绑定；" +
    "目标过滤器里的 controller: \"event-player\" 是为该缺失选择器保留的记录占位，绝不用战场控制者顶替（同 rad/rakelstake 的缺口）。" +
    "(2)「The first time a player plays a non-token unit here each turn」是**按玩家**、每回合一次、且限定「打出到本战场」：" +
    "TriggerSpec.once 的 per-turn/per-combat/per-chain/per-game 以单个注册 + 来源为频度键（frequencyKey 用 source.ref），" +
    "不是每名事件玩家各一次；封闭的 card-played 载荷也不暴露打出目的地战场，因此频度与 here 限制都无法求值" +
    "（程序里的 once 是 printed 频度的记录占位，here/nonToken 键同样记录意图）。" +
    "(3) CardProgram → TriggerRegistration 的生产绑定已合入，但本声明仍缺事件玩家选择器、per-player once 频度，以及 card-played 的打出地点/非 token 载荷，" +
    "因此无法把 190.6.c 的选择者和 here 限制翻译成可执行过滤器。" +
    "依赖：事件玩家选择器、per-player once 频度与打出地点/非 token 载荷（契约变更请求；位置工作流 RIFT-357）。" +
    "golden 用参考内核真实执行可选包装与 effect.move（移动到该单位自己的 Base），并用目标过滤器形状断言「另一个、你控制、在此」的意图。",
  sourceText:
    "The first time a player plays a non-token unit here each turn, they may move another unit they control here to its base.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // "a non-token unit": the played event object (383.4.a.4).
          object: { type: "unit" },
          // Documented placeholders: "here" (053.3) and the non-token
          // restriction are not evaluable from the closed card-play payload,
          // and the per-player first-play window has no frequency scope (see
          // judgeReason). They record the printed condition; they are not
          // executable filters.
          here: true,
          nonToken: true
        },
        // "the first time a player plays … each turn" (383.1.b). The merged
        // once scopes cannot key this per event player, so the recording uses
        // the closest per-turn scope and the gap is stated in judgeReason.
        once: "per-turn"
      },
      // 383.3.a: "they may" is the first part of the effect, so the named
      // player decides whether to perform the ability at finalization. The
      // decision is recorded on the ability and realised by the contract §3.9
      // choice.optional wrapper below (the sibling battlefield spelling of
      // ruined-monastery).
      optional: true,
      body: [
        {
          id: "star-spring.opt-in",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Move another unit you control here to its base?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  // 144.4.b / 448.1 / 449.2 / 451: one Move whose destination
                  // is the moved unit's own Base ("its base"), not a Recall
                  // (457). controller-base resolves the destination from the
                  // moved object's controller.
                  id: "star-spring.move-to-base",
                  op: "effect.move",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { target: "star-spring.unit-here" }
                    },
                    to: { kind: "constant", value: "controller-base" },
                    linkKey: { kind: "constant", value: "movedUnit" }
                  }
                }
              ]
            }
          },
          // 355.12: the chosen unit is locked with the ability (355.8), even
          // when the player declines the optional Move.
          targets: [
            {
              id: "star-spring.unit-here",
              // "another unit they control here": a unit of the event player's
              // at this Battlefield, excluding the unit that was just played
              // (355.9.a.1, 355.10, 740.1.a). The chooser/owner binding is the
              // judged part (see judgeReason); the filter keeps the printed
              // shape.
              filter: {
                type: "unit",
                location: "battlefield",
                sameLocationAs: "self",
                other: true,
                controller: "event-player"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;
