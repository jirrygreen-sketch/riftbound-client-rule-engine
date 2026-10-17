import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Taric, Protector (ogn-074-298).
 * CR v1.5 814 / 815: both printed keywords are declarations only; Shield defaults to 1.
 * The granted Shield is a continuous ability-layer effect on OTHER friendly units here.
 * There is no battlefield-only qualification: here also includes the host's Base.
 *
 * Review (2026-10-17, RIFT-650): sourceText matches deck-catalog ogn-074-298 and the
 * IR keeps the printed values (Shield 1 via 814.1.b.3, Tank with no value via 815),
 * the "here" anchor (sameLocationAs: self) and the "other" exclusion. Nothing is
 * added or approximated; the gap below is still open on the merged engine.
 * Execution evidence for what does run (play/payment/keyword expansion and the
 * fail-closed static bind attempt): packages/card-dsl/test/cards/templates/keyword-keyword-static-650.test.mjs.
 */
const abilities: Ability[] = [
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
];

const program = {
  canonicalCardId: "card.hash-28133bb22a32a90c2f06d32acb4d895d0867ae822e8e802eb227f80405c2ea6f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（2026-10-17 RIFT-650 复核，均有模板测试执行证据）：" +
    "(1) [Tank] 的 KeywordDef 已展开为 continuous.combat，但 combat 的伤害分配仍只接受 keywordPriority: \"proven-none\"" +
    "（combat/base-combat-allocation.ts），没有消费 815.1.b/.c 的伤害优先分支。" +
    "(2) [Shield]（814.1.c）展开为 arithmetic 层的 continuous.might，条件读 object-property(self, \"designation\")，" +
    "而 ObjectSnapshot 只有 combatRole；解释器抛 MissingInformation、生产 static binder 按 false 处理，defender 时的 +1 Might 不生效。" +
    "(3) 「Other friendly units here have [Shield]」的 continuous.keyword 需要按宿主控制者、同地点并排除宿主的动态相对筛选，" +
    "但 programs/statics.ts 的 staticFilter 对 exclude/other 抛 \"Static exclude anchor needs a dynamic relative filter\"，" +
    "该授予既不能注册进图层，也没有授予关键词的二次展开。不近似实现。",
  abilities,
  sourceText: "[Shield] (+1 :rb_might: while I'm a defender.)\n[Tank] (I must be assigned combat damage first.)\nOther friendly units here have [Shield]."
} satisfies CardProgram;

export default program;
