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
  judgeReason: "effect.buff 当前必须传 TargetSpec id，缺非目标 self ObjectSelector；无限 Buff 许可也没有被消费，" +
    "因此已有 Buff 时仍会按 702.3.a 跳过，不能表达 CR 427.1.b.2。Shield 展开仍读取未进入" +
    "ObjectSnapshot/layer predicate 的 combatRole/designation 条件（CR 814）。依赖：self 目标形状、" +
    "多 Buff 许可与 Defender designation 条件求值；不能伪造自身目标或绕过 Buff 原语直接改计数。",
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
