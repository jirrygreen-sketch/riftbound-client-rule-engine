// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-facedown-not-referenceable-by-characteristics (CR v1.5 811.5.a, 107.3.f)
//
// 状态：test.todo。缺什么：特征查询对面朝下牌返回空特征。
//   * 811.5.a：面朝下牌“不是带 Hidden 的牌”，所以“数你控制的 Hidden 牌”必须数到 0。
//   * 实测（/tmp/RIFT-628-rules-tests-privacy/probe6.mjs）：src/layers/filter.ts 的
//     matchesObjectFilter 用 keywords 过滤时对面朝下快照仍返回 true —— 底层印刷关键字
//     泄漏给了查询。src/chain/engine.ts 的 context.query 正是把 filter 交给它。
//   * 因此无法写出“数到 0、伤害为 0”的通过测试；把它写成通过测试等于把现状当预期。
// 需要的机制：查询/过滤层对面朝下对象屏蔽印刷特征（811.5.a、128.4）。
import test from "node:test";

test.todo(
  "privacy-facedown-not-referenceable-by-characteristics: 面朝下牌的特征查询返回空、Hidden 计数为 0 " +
  "[M]（缺：811.5.a 的特征屏蔽；src/layers/filter.ts 的 keywords 过滤对面朝下对象泄漏印刷关键字）"
);

test.todo(
  "privacy-facedown-not-referenceable-by-characteristics: chain context.query 对 keywords: [Hidden] 不命中面朝下牌 " +
  "[M]（同一根因的第二条断言面：src/chain/engine.ts 的 context.query 直接复用同一个 matchesObjectFilter）"
);

