import type { CardProgram } from "../../ir/index.js";

/**
 * Wages of Pain — sfd-070-221 (CR v1.5 811.1, 187.5, 184.1/185.2.d).
 *
 * Status: judge-required, re-verified 2026-10-23 against the merged production
 * path. RIFT-987 binds the Gold carrier to its canonical 187.5 program, whose
 * Reaction Add really produces Universal Power ([A]); RIFT-961 supplies the
 * Hide transaction, private facedown storage, next-turn Reaction permission,
 * source-Battlefield target restriction, and play-from-facedown transition.
 *
 * Two production gaps remain. First, the normal ProgramBinding + Chain Play of
 * Gold ends ready rather than under the card's entersExhausted stipulation
 * (effects/testing/test-kernel.ts:651-664, used by the production Play host,
 * moves the token to Board without applying the TokenSpec exhausted entry).
 * Second, programs/play.ts scopeHiddenBody applies its 811.1.d play-location
 * rewrite to every effect.token, including this Gear token, and then rejects a
 * non-Deploy Gear at a Battlefield. CR 811.1.d.5 limits that override to playing
 * a Unit; this spell's Gold is still played to the controller's Base.
 */
const wagesOfPain = {
  canonicalCardId: "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前剩余缺口（2026-10-23 生产路径实测，不近似实现）：(1) CR 184.1 的 exhausted entry 未保持。effect.token.ts:343-371 将 entersExhausted 写入 create-token 的 TokenSpec，但普通 Play 经 effects/testing/test-kernel.ts:651-664（production host perform）的 create-token→Play→Base 路径后，只执行 moveCurrent 而不再应用 TokenSpec exhausted；最终实际对象为 exhausted=false。卡文明确要求 Play a Gold gear token exhausted。" +
    "(2) Hidden 来源仍错误改 scope。engine-core/src/programs/play.ts:126-165 的 hidden scopeHiddenBody 会把每条 effect.token 的 location 改写到牌所隐藏的战场；随后 :135-138、:155-158 因 Gold 是未带 Deploy 的 Gear 而抛 judge-required。CR 811.1.d.5 只要求 hidden spell 让你 play a unit 时在该战场施放 Unit；本卡第二句的 Gold gear token 仍应按 359.2.d/811.2 进入控制者 Base。" +
    "已由生产链路验证：3 Energy、Finalize 目标锁定与 Resolve 重验、造成 3 点伤害、Gold 创建并绑定 187.5 程序及 Universal Power Add；Hide 行动、private facedown、次回合 Reaction 与来源战场目标限制也通过。因上述两项任一项都会使整卡行为错误，保持 judge-required。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "damaged-unit" }
          },
          targets: [
            {
              id: "damaged-unit",
              filter: { type: "unit", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Play a Gold gear token exhausted." — the token is created on the
          // Chain, played as a real zero-cost token (185.2.a/185.3.a.1), enters
          // the controller's Base with the explicit 184.1 override, and then
          // binds Gold's canonical 187.5 program through lifecycle attachment.
          id: "play-gold-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            entersExhausted: { kind: "constant", value: true },
            linkKey: { kind: "constant", value: "goldToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted."
} satisfies CardProgram;

export default wagesOfPain;
