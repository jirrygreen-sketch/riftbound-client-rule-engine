import type { CardProgram } from "../../ir/index.js";

/**
 * Lee Sin, Ascetic (ogn-078-298).
 * CR v1.5 814 / 427.1.b.2 / 702.3: Shield, an exhaust-cost self Buff, unlimited Buffs.
 * The objects operand and maximum:null permission are BLOCKED declarations;
 * current effect.buff has neither a non-target self selector nor a permission hook.
 * Do not encode me as a chosen target or approximate an unlimited Buff with amount:N.
 */
const program = {
  canonicalCardId: "card.hash-cc6ad3795219f298711ebf12535a88b5542ad11cc99575a77634de551464784e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "effect.buff 当前必须传 TargetSpec id，缺非目标 self ObjectSelector，且 snapshot.buffs > 0 时无条件跳过，尚不消费 CR 427.1.b.2 的无限 Buff 许可。Shield 展开仍读缺失的 designation 字段（CR 814）。依赖 RIFT-1/83/91 的选择器、多 Buff 许可与关键词图层接线，不能伪造自身目标或绕过 Buff 原语直接改计数。",
  abilities: [
    {
      kind: "keyword",
      keyword: "shield"
    },
    {
      kind: "activated",
      cost: {
        payments: [
          {
            kind: "exhaust",
            object: "self"
          }
        ]
      },
      timing: "action",
      body: [
        {
          id: "buff-self",
          op: "effect.buff",
          args: {
            mode: {
              kind: "constant",
              value: "buff"
            },
            objects: {
              kind: "constant",
              value: "self"
            }
          }
        }
      ]
    },
    {
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        action: "buff",
        filter: {
          object: "self"
        },
        maximum: null
      }
    }
  ],
  sourceText: "[Shield] (+1 :rb_might: while I'm a defender.)\n:rb_exhaust:: Buff me. (I get a +1 :rb_might: buff.)\nI can have any number of buffs."
} satisfies CardProgram;

export default program;
