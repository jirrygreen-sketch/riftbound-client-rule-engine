import type { CardProgram } from "../../ir/index.js";

/**
 * Sabotage (ogn-156-298) — Spell, 1 energy + 1 Body power.
 *
 * Printed text:
 *   Choose an opponent. They reveal their hand. Choose a non-unit card from
 *   it, and recycle that card.
 *
 * Modeling notes (Core Rules v1.5):
 * - "Choose an opponent" chooses a Player to affect, so it is Targeted
 *   (355.7; 355.9.a lists "a player" among valid targets). The merged IR has no
 *   player-target form: TargetSpec filters are ObjectFilters, ResolveContext
 *   exposes only ctx.targets(specId): ObjectRef[] (contract 3.6), and invalid
 *   player-id strings negate rather than ignore (effect.reveal / effect.draw
 *   document that unresolvable player expressions negate as impossible). The
 *   TargetSpec below therefore records the rules shape for review, and the
 *   reveal carries the same unbound "opponent" placeholder.
 * - "They reveal their hand" is the merged effect.reveal primitive (425.3;
 *   425.3.a: revealing a zone without a count presents every card currently in
 *   it; 425.1.a.2: revealed cards stay in their zone). Its player argument must
 *   be the chosen opponent, which is the missing player-target binding.
 *   The golden test executes this clause with a concrete opponent.
 * - "Choose a non-unit card from it, and recycle that card" is a resolve-time,
 *   non-target choice made from the revealed hand followed by a recycle
 *   (417.1.a; 425.4: cards can be manipulated while revealed). Two pieces are
 *   missing, so the card is judge-required:
 *   - the merged effect.recycle offers target / objects (already-chosen
 *     references) / from{zone, owner, amount}; the from form has the zone's
 *     owner choose (effect.recycle chooses with chooser: owner) and has no card
 *     filter, while this spell's controller must choose here;
 *   - the ObjectFilter vocabulary has no "is not a unit" form, and the
 *     resolve-time choose descriptor that effect.stun / effect.exhaust accept
 *     has no effect.recycle counterpart.
 *   The intended choice is recorded on the recycle instruction for review.
 */
const sabotage = {
  canonicalCardId: "card.hash-ec4ca2df92b603ace480ec363b3bd1f1ce182f05602b2dd361a08eadfd7574a6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两步依赖未合入：(1)「Choose an opponent」按 355.7/355.9.a 是玩家目标，但已合入的 IR 没有玩家目标形态" +
    "（TargetSpec.filter 是 ObjectFilter；ResolveContext 只有 ctx.targets(specId): ObjectRef[]，契约 3.6），" +
    "也没有把目标绑定到后续指令 player 实参的表达式；(2)「Choose a non-unit card from it, and recycle that card.」" +
    "是结算时在已展示手牌里做非目标选择再回收（417.1.a、425.4）：已合入的 effect.recycle 只有 target / objects" +
    "（已选定引用）/ from{zone,owner,amount}，from 由区域拥有者选择且没有卡牌过滤；ObjectFilter 没有“非单位”的否定形态，" +
    "effect.stun / effect.exhaust 的结算期 choose 描述符在 effect.recycle 上尚未实现。" +
    "reveal 与 recycle 子步骤已有执行测试（把对手绑定为具体玩家后）；依赖：玩家目标/绑定表达式（target.player）、" +
    "effect.recycle 结算期 choose + 非单位过滤。整卡保持 judge-required，不近似实现。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          id: "sabotage.reveal-hand",
          op: "effect.reveal",
          args: {
            // "They reveal their hand": the chosen opponent reveals. The
            // player-target binding is the missing expression form (see
            // judgeReason), so the placeholder is carried here.
            player: { kind: "constant", value: "opponent" },
            zone: { kind: "constant", value: "hand" }
          },
          // The player target itself (355.7). The merged ObjectFilter cannot
          // match players; these keys annotate the intended, unsupported shape.
          targets: [
            {
              id: "sabotage.opponent",
              filter: { kind: "player", player: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "sabotage.recycle-chosen-card",
          op: "effect.recycle",
          linkedTo: "sabotage.reveal-hand",
          args: {
            // "Choose a non-unit card from it, and recycle that card": a
            // resolve-time, non-target choice over the revealed cards,
            // restricted to non-unit cards and made by the spell's controller.
            // Described in the effect.stun / effect.exhaust choose-descriptor
            // shape that effect.recycle does not implement yet.
            choose: {
              kind: "constant",
              value: {
                id: "sabotage.recycle-choice",
                filter: { zone: "hand", owner: "opponent", notType: "unit" },
                chooser: "controller",
                visibility: "public",
                prompt: "Choose a non-unit card from the revealed hand to recycle."
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Choose an opponent. They reveal their hand. Choose a non-unit card from it, and recycle that card."
} satisfies CardProgram;

export default sabotage;

