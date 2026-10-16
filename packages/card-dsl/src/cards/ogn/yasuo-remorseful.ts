import type { CardProgram } from "../../ir/index.js";

/**
 * Yasuo, Remorseful (ogn-076-298).
 * CR v1.5 383.4.e.1-383.4.e.2.a: first attacker designation per combat.
 * CR 418 / 740.1.b: damage uses the source's current Might and targets one enemy here.
 * No printed-Might constant, manual damage action, or single-card resolver is used.
 */
const program = {
  canonicalCardId: "card.hash-751e2b1c16ab2529b3d0bf37e5309cfde9a7b41589d08799cf53a9a8ef42e5e8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "effect.damage 已支持动态来源 Might，但 amount schema 要求 Expr，解释器却先求值为数字，原始 body 尚不能贯通。敌方相对控制者及 here 同地点筛选、自身 attack-declared 订阅绑定仍需 RIFT-1/120 的 CardProgram 适配；CR 383.4.e 要求每场战斗首次获得攻击身份才触发。伤害原语测试不构成整卡执行证据。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: {
          object: "self"
        },
        once: "per-combat"
      },
      optional: false,
      body: [
        {
          id: "deal-might",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: "source",
              property: "might"
            },
            target: {
              kind: "constant",
              value: "enemy-here"
            }
          },
          targets: [
            {
              id: "enemy-here",
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                sameLocationAs: "source"
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "When I attack, deal damage equal to my Might to an enemy unit here."
} satisfies CardProgram;

export default program;
