import type { CardProgram } from "../../ir/index.js";

/**
 * Black Flame Altar — CR v1.5 053.3/199.1 (here), 816.3
 * (Temporary characteristic), 479.3 (ability layer), 814.1.b.3/814.1.c
 * (Shield 1 while defender). Static binding and grants exist; the exact
 * location/keyword gate and dynamic Shield expansion still need consumers.
 */
export default {
  canonicalCardId: "card.hash-c4cfa13109f9e65730089b31964d83518df125baae9a5cb10592187c82a44c56",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5）：(1) static 图层绑定已由 createEngineStaticBinder 合入，sameLocationAs:self 也会被转换为 source.location；但 programs/statics.ts 拒绝 keywords 过滤键，layers/filter.ts 又按引用比较结构化 LocationRef，仍不能可靠匹配 053.3/199.1 的「本战场上且带 Temporary 的单位」。(2) grant-keyword 与 Temporary/Shield 展开已存在，但图层授予的 Shield 不会自动重新进入关键词展开/绑定；Shield 的条件又读取未由 ObjectSnapshot 提供的 designation（实际战斗身份字段为 combatRole），故 814.1.c/814.1.d 的防御期间 +1 Might 仍不完整。需关键词特征过滤、LocationRef 值匹配、动态关键词展开与防御身份条件接线（条件谓词 RIFT-359）。",
  sourceText:
    "Units here with [Temporary] have [Shield]. (+1 :rb_might: while they're defenders.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        // 814.1.b.3: the printed [Shield] has no value, so the granted keyword
        // is Shield 1; the expansion lives in keywords/Shield.ts.
        keywords: [{ id: "shield", value: 1 }],
        // 479.3: granting an ability belongs in the ability layer
        // (contract §3.4 layer order copy → trait → ability → arithmetic).
        layer: "ability",
        filter: {
          type: "unit",
          zone: "board",
          // 053.3/199.1: the static binder resolves "here" to source.location;
          // the layer matcher still needs LocationRef comparison by value.
          sameLocationAs: "self",
          // 816.3: "with [Temporary]" is a keyword characteristic gate; no
          // static filter binder accepts this key yet. It remains declarative
          // behind the judge-required status guard.
          keywords: ["Temporary"]
        }
      }
    }
  ]
} satisfies CardProgram;
