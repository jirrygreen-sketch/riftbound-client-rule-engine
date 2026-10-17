import type { CardProgram } from "../../ir/index.js";

/**
 * Taric, Protector (ogn-074-298).
 * CR v1.5 814 / 815: both printed keywords are declarations only; Shield defaults to 1.
 * The granted Shield is a continuous ability-layer effect on OTHER friendly units here.
 * There is no battlefield-only qualification: here also includes the host's Base.
 */
const program = {
  canonicalCardId: "card.hash-28133bb22a32a90c2f06d32acb4d895d0867ae822e8e802eb227f80405c2ea6f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason: "Tank 关键词定义已存在，但 combat 图层没有消费 Tank 的伤害优先分支（CR 815）；Shield 展开需要 defender 时的 Might 修正，而当前 ObjectSnapshot 使用 combatRole、不是 designation（CR 814）。Other friendly units here 的 continuous.keyword 还需要按宿主控制者、同地点并排除宿主的动态相对筛选；现有 static binder 会拒绝 exclude/other 过滤。",
  abilities: [
    {
      kind: "keyword",
      keyword: "shield"
    },
    {
      kind: "keyword",
      keyword: "tank"
    },
    {
      kind: "static",
      effect: {
        kind: "continuous.keyword",
        layer: "ability",
        filter: {
          type: "unit",
          zone: "board",
          controller: "controller",
          sameLocationAs: "self",
          exclude: "self"
        },
        keyword: "shield"
      }
    }
  ],
  sourceText: "[Shield] (+1 :rb_might: while I'm a defender.)\n[Tank] (I must be assigned combat damage first.)\nOther friendly units here have [Shield]."
} satisfies CardProgram;

export default program;
