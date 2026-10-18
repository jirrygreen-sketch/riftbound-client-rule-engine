import type { CardProgram } from "../../ir/index.js";

/**
 * Black Flame Altar — CR v1.5 053.3/199.1 (here), 816.3
 * (Temporary characteristic), 479.3 (ability layer), 814.1.b.3/814.1.c
 * (Shield 1 while defender). Static binding and grants exist; the exact
 * location/keyword gate and the defender gate of the granted Shield still need
 * consumers.
 *
 * 2026-10-18 复核后的真实缺口（不近似实现）：
 * 1. 「Units here with [Temporary]」需要“本战场 + 带 Temporary 关键词”的集合谓词。
 *    createEngineStaticBinder 会把 sameLocationAs:self 转成 source.location（实测
 *    能产出结构化 LocationRef），但 programs/statics.ts 的 staticFilter 会直接拒绝
 *    keywords 键（实测抛 Unsupported static filter field keywords），所以带关键词
 *    门槛的 filter 无法注册。keywords 键在图层匹配器里也不是可求值维度。
 * 2. 位置门槛本身也不可用：图层应用路径 layers/engine.ts 的 applyLayer 用
 *    layers/filter.ts 的 matchesObjectFilter 匹配 filter，后者对结构化 location 是
 *    引用比较（value.location !== object.location，随后只回落比较 location.type），
 *    因此 binder 解出的 { type:"battlefield", id } 永远不等于对象自己的 location
 *    对象（实测同一战场的单位也不匹配，单位的关键词里没有 Shield）。所以去掉 keywords
 *    并不会放宽为“本战场所有单位”，而是让声明对任何对象都不生效；两种写法都不能
 *    作为 053.3/199.1 的执行证据。规则查询路径（layers/rules/query.ts 的
 *    objectFilterMatches）是按 JSON 比较的，因此这不是同一处接线。
 * 3. 814.1.c/814.1.d 的「+1 Might while they're defenders」：图层确实把 Shield 写进
 *    了快照的 keywords（实测 unit 的 keywords 变为 [Temporary, Shield 1]），但该
 *    Shield 不会再进入关键词展开，因此它的 static continuous.might 从未被注册
 *    （实测 might 保持 3）。此外 Shield.ts 的展开条件读取 designation，而
 *    ObjectSnapshot 暴露的是 combatRole；图层条件求值走基础 evaluateExpression，
 *    对不存在的 designation 抛 MissingInformation 后 fail-closed 恒假。
 * 4. production 对局把 battlefield 生成为 chain 区 token（game/lifecycle.ts 只
 *    create-token），attachProgramLifecycle 只在 object-enters-board 时绑定，
 *    因此真实对局里本卡连 static 注册都不会发生。
 */
export default {
  canonicalCardId: "card.hash-c4cfa13109f9e65730089b31964d83518df125baae9a5cb10592187c82a44c56",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5）：(1) static 图层绑定与 sameLocationAs:self → source.location 的转换已合入，" +
    "但 programs/statics.ts 的 staticFilter 直接拒绝 keywords 过滤键（实测抛 Unsupported static filter field keywords），" +
    "053.3/199.1 的「本战场上且带 Temporary 的单位」仍无法注册为集合。" +
    "(2) 位置门槛在图层应用路径也不匹配：layers/engine.ts 的 applyLayer 经 layers/filter.ts 的 matchesObjectFilter " +
    "比较 filter，其中结构化 location 走引用比较（value.location !== object.location），binder 解出的 " +
    "{ type:\"battlefield\", id } 与对象自身的 location 对象永不相等（实测同战场单位也不匹配），" +
    "故删掉 keywords 不会扩大为“本战场所有单位”，而是对任何对象都不生效；两种写法都不能作为 053.3/199.1 的执行证据。" +
    "（layers/rules/query.ts 的 objectFilterMatches 是按 JSON 比较，规则查询路径不受此影响。）" +
    "(3) grant-keyword 与 Temporary/Shield 展开已存在，但图层授予的 Shield 不会重新进入关键词展开：实测图层把 Shield 1 写进单位 " +
    "keywords（[Temporary, Shield 1]），但它的 static continuous.might 从未注册、might 保持 3；" +
    "同时 Shield 展开条件读取 designation（实际战斗身份字段是 combatRole，contract 3.8），" +
    "基础 evaluateExpression 对该不存在字段抛 MissingInformation 后 fail-closed 恒假，" +
    "814.1.c/814.1.d 的防御期间 +1 Might 仍不完整。" +
    "(4) production 对局把 battlefield 生成为 chain 区 token（game/lifecycle.ts 只 create-token），" +
    "attachProgramLifecycle 只在 object-enters-board 时绑定，真实对局因此尚未注册本卡。" +
    "需关键词特征过滤、图层位置匹配、动态关键词展开、防御身份条件接线与 battlefield 入 Board 的生命周期。",
  sourceText:
    "Units here with [Temporary] have [Shield]. (+1 :rb_might: while they're defenders.)",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        // 814.1.b.3: the printed [Shield] has no value, so the granted keyword
        // is Shield 1; the expansion lives in keywords/Shield.ts.
        // KeywordId matches effects/keywords/Shield.ts (CR 814.1.b.3).
        keywords: [{ id: "Shield", value: 1 }],
        // 479.3: granting an ability belongs in the ability layer
        // (contract §3.4 layer order copy → trait → ability → arithmetic).
        layer: "ability",
        filter: {
          type: "unit",
          zone: "board",
          // 053.3/199.1: the static binder resolves "here" to source.location,
          // but the layer application path now compares that structured value
          // by reference, so this switch alone still matches nothing (see
          // judgeReason 2). The declaration is retained as the authored form.
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
