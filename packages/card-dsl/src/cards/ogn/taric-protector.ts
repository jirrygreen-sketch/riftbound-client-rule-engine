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
  judgeReason: "缺 Tank 关键词展开与 continuous.combat（CR 815），Shield 展开仍引用 designation 而当前 ObjectSnapshot 仅有 combatRole（CR 814）。Other friendly units here 的 continuous.keyword 需要相对控制者、同地点和排除自身的图层绑定；依赖 RIFT-1/83/91 的关键词/图层接线，不在卡文件重写 Shield 或 Tank。",
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
