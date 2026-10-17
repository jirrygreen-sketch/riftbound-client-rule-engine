import type { CardProgram } from "../../ir/index.js";

/**
 * Black Flame Altar — CR v1.5 053.3/199.1 (here), 816.3
 * (Temporary characteristic), 479.3 (ability layer), 814.1.b.3/814.1.c
 * (Shield 1 while defender). Static binding and grants exist; the exact
 * location/keyword gate and the defender gate of the granted Shield still need
 * consumers.
 *
 * 复核后的真实缺口（不近似实现）：
 * 1. 「Units here with [Temporary]」需要“本战场 + 带 Temporary 关键词”的集合谓词。
 *    createEngineStaticBinder 会把 sameLocationAs:self 转成 source.location（实测
 *    该值比较可用），但 programs/statics.ts 的 staticFilter 会直接拒绝 keywords 键
 *    （实测抛 Unsupported static filter field keywords），所以带关键词门槛的
 *    filter 无法注册；去掉 keywords 会把授予扩大到本战场所有单位。
 * 2. 814.1.c/814.1.d 的「+1 Might while they're defenders」由 Shield 展开读取
 *    designation/combatRole，但实测展开出的 static continuous.might 经同一 binder
 *    绑定后并不作用于对象：graph 上缺少把图层授予的 Shield 重新送入关键词展开的
 *    接线，且 ObjectSnapshot 的实际战斗身份字段是 combatRole（contract 3.8），
 *    Shield 展开读取的 designation 并不存在，条件按 fail-closed 恒假。
 */
export default {
  canonicalCardId: "card.hash-c4cfa13109f9e65730089b31964d83518df125baae9a5cb10592187c82a44c56",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5）：(1) static 图层绑定与 sameLocationAs:self → source.location 的转换已合入，" +
    "但 programs/statics.ts 的 staticFilter 直接拒绝 keywords 过滤键（实测抛 Unsupported static filter field keywords），" +
    "053.3/199.1 的「本战场上且带 Temporary 的单位」仍无法注册为集合；直接删掉 keywords 会把授予扩大到本战场所有单位。" +
    "(2) grant-keyword 与 Temporary/Shield 展开已存在，但图层授予的 Shield 不会重新进入关键词展开/绑定：" +
    "Shield 展开的 static continuous.might 读取 designation（实际战斗身份字段是 combatRole，contract 3.8），" +
    "ObjectSnapshot 没有 designation，条件按 fail-closed 恒假，814.1.c/814.1.d 的防御期间 +1 Might 仍不完整。" +
    "需关键词特征过滤、动态关键词展开与防御身份条件接线（条件谓词 RIFT-359）。",
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
