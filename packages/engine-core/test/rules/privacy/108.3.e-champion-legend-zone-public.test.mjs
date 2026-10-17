// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-public-zones-visible-all-views (Champion/Legend Zone half, CR v1.5 108.3.e, 107.4.c)
//
// 状态：test.todo。缺什么：新内核没有 Champion Zone / Legend Zone 区域，也没有把
// 卡放进这两个区域的动作。
//   * src/effects/contract.ts 的 ZoneId 只有 hand | deck | rune-deck | trash |
//     banishment | board | rune-zone | chain；
//   * src/game/lifecycle.ts 的 createMatch 用 create-token 把 Champion Legend /
//     Chosen Champion 建到 Chain Zone（probe：token-1..4 的 zone 均为 'chain'），
//     没有任何 GameAction 把它们移入这两个区域；
//   * src/projection/v2 接受 championZone / legendZone 输入，但没有内核路径生成它。
// 需要的机制：ZoneId 增加 champion / legend 区域、初始化放置动作，以及 createMatch
// 把设置结果落到这两个区域（属 zones/ 与 game/ 的其它任务范围）。
import test from "node:test";

test.todo(
  "privacy-public-zones-visible-all-views: Champion Zone 与 Legend Zone 的内容对四视角公开 " +
  "[M]（缺：ZoneId/champion-legend 区域与初始化放置动作，src/game/lifecycle.ts 目前把两者留在 Chain Zone）"
);
