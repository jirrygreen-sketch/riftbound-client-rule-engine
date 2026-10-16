import type { CardProgram } from "../../ir/index.js";

/**
 * Annie, Stubborn (ogs-010-024) — Unit, 4 energy / 1 power (Chaos), Might 3.
 *
 * sourceText (deck-catalog.json, ogs-010-024, verbatim):
 *   "When you play me, return a spell from your trash to your hand."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1："When you play me" 是 Play Effect，在打出完成后进链
 *   （420.4.a）；时点用 card-played（events/timing-points.ts），filter 指向本卡。
 * - 355.10.a："Return a spell from your trash to your hand" 以垃圾场里的卡为目标
 *   （"your trash is Public"），故是选目标 targets（355.7），不是 pick；
 *   355.10.d 说明只有按特征程序化选出的集合才不算目标，本卡明确要求玩家选。
 * - 141.2.b/148.2.b：卡类型在所有区域都有效，故垃圾场里的法术仍按 type: "spell"
 *   识别；157：法术结算后进入其拥有者的垃圾场。
 * - 108.2.b：垃圾场是每名玩家自己的区域，故 filter 用 owner: "controller"
 *   （056 的归属规则保证卡牌只会进入拥有者的区域）。
 * - 区域移动经封闭 GameAction return-to-hand（契约 3.6），由 effect.zone 提交。
 * - 目标在结算时重新校验（355.9、359.3.e.5-e.7）：引用已失效 → 指令 ignored。
 *
 * 状态：executable。整卡只用已合入的 effect.zone 原语与契约 3.1 的 triggered 形状；
 * 触发订阅读取时点由 chain/events 管线负责，golden 测试按 golden 分层真实执行指令体
 * 并覆盖目标失效分支，未合入的管线接线在 test.todo 中注明。
 */
export default {
  canonicalCardId: "card.hash-957d137989f6eb7bb87001a5bdd8aa194b1e53e56b635b1b841362d901c3b39d",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "annie-stubborn.return-spell",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "annie-stubborn.spell-in-trash" },
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "annie-stubborn.spell-in-trash",
              filter: { type: "spell", zone: "trash", owner: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When you play me, return a spell from your trash to your hand."
} satisfies CardProgram;
