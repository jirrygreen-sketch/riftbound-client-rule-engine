import type { CardProgram } from "../../ir/index.js";

/**
 * Black Rose Sanctum (rad-159-167) — Battlefield (domainless, RAD).
 *
 * Printed text:
 *   For each player, the first time each turn a non-token unit they control
 *   dies here, they play a 1 :rb_might: Recruit unit token to their base.
 *
 * Rules evidence (Core Rules v1.5):
 * - 429.1 / 429.2.a: a unit Dying is it going from the Board to its owner's
 *   Trash; the "object-killed" timing point (events/timing-points.ts, refs
 *   429.1 / 808.1.d) is the merged subscription point and carries the last
 *   known snapshot of the dying object.
 * - 187.1: a 1 Might Recruit is a domainless unit token with 1 Might and the
 *   Recruit tag; it is a merged definition in effect.token.
 * - 440.2.c / 185.2.a / 350.2 / 354: playing a NEW token means creating it on
 *   the Chain and then playing it, which is why the intended body declares
 *   effect.token with mode "play" rather than a direct Board creation.
 * - 383.3.e.1: "the first time each turn" is a frequency limit on the trigger.
 *
 * Status: judge-required (2026-10-17 source audit).
 * The dying player's identity exists on object-killed, but effect.token creates
 * for ctx.controller only. It needs an event-player binding so both creator and
 * base belong to that player. The here anchor and per-player/per-turn frequency
 * still lack runtime consumers. Generic token play is routed by ChainEngine;
 * frozen Recruit definitions have cardId:null and need an ability-less-token
 * describePlay adapter before the production ProgramRegistry can admit them.
 */
export default {
  canonicalCardId: "card.hash-bb13774c245790dac24ea6928494dad2f51a511704b3a77b260531f06ae67788",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1)「they … their base」缺死亡单位控制者到 effect.token 创建者与目的地的绑定：原语固定 ctx.controller，" +
    "只允许该控制者基地；不能只把 location 改为对手基地（CR 182 / 183 / 440.4）。" +
    "(2)「here」缺来源战场关系过滤（053.3），perPlayerFrequency 也没有消费方。" +
    "(3)「For each player, the first time each turn」缺按事件玩家分桶的 once 收据；" +
    "TriggerSpec.once 的 per-turn 是整个注册一次（383.3.e.1）。" +
    "(4) effect.token 的 Recruit 定义虽可在参考内核 play，但 cardId:null 无法由 ProgramRegistry.get 绑定；" +
    "生产 ChainEngine 的 describePlay 仍需无能力 Token 适配（187.1 / 440.2.c）。",
  sourceText:
    "For each player, the first time each turn a non-token unit they control dies here, they play a 1 :rb_might: Recruit unit token to their base.",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          // "a non-token unit they control dies here" — the dying object
          // filter names any player's unit (375.10-style unit reference).
          object: {
            type: "unit",
            controller: "any",
            characteristics: { isToken: false }
          },
          // "here" and the per-player window remain descriptive keys; the
          // non-token predicate itself uses the merged characteristics field.
          here: true,
          perPlayerFrequency: "once-per-turn"
        }
      },
      optional: false,
      body: [
        {
          // "they play a 1 [M] Recruit unit token to their base" — Recruit is
          // the merged 187.1 definition; play mode is the printed "play"
          // (440.2.c / 185.2.a). The location is the controller-base
          // placeholder for the missing per-player destination.
          id: "black-rose-sanctum.play-recruit",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;
