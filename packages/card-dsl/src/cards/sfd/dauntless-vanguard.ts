import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Dauntless Vanguard (sfd-093-221, fiora-sfd M1 卡组).
 *
 * 原文："You may play me to an occupied enemy battlefield."
 *
 * 规则依据（CR v1.5）：
 * - 349 Playing Cards / 420.3.b.2（打出时的合法位置在 Finalize 校验）；
 * - 类比 822 Ambush 的建模方式（静态能力扩展合法打出位置）：本能力是一个
 *   静态的合法位置许可——把"被占据的敌方战场"加入本单位的合法打出位置。
 *   契约 3.1 的 play ability 只有 `restriction`（限制）字段，没有"许可"字段，
 *   因此按 822.1.b/c 的先例用 static + ContinuousEffect 表达（ContinuousEffect
 *   的 kind 是开放字符串，由 layers/ 消费）。
 */
const abilities: Ability[] = [
    {
      kind: "static",
      effect: {
        kind: "play-location-permission",
        value: {
          kind: "constant",
          value: {
            zone: "battlefield",
            battlefield: { occupied: true, controller: "opponent" },
            appliesTo: "self"
          }
        },
        duration: "while-in-hand"
      }
    }
  ];

const program = {
  canonicalCardId: "card.hash-cf0b322a78010676e3d8b287830194a3bdc8970e65a141578ae8a3074ebd956f",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText: "You may play me to an occupied enemy battlefield."
} satisfies CardProgram;

export default program;
