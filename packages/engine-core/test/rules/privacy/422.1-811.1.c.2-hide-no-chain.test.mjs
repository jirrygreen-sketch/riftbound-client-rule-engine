// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-hide-no-chain-preserves-privacy (CR v1.5 422.1, 811.1.c.2, 107.3.f)
//
// 状态：test.todo。缺什么：Hide 自由动作与 Facedown Zone 目的地。
//   * src/cost/kinds/hidden.ts 只锁定并支付 [A] 隐藏费，头注释明确“Hide/play 权限、
//     facedown 区域与 Hidden 移动仍属 zone/timing owner”；src/effects/keywords/Hidden.ts
//     同样只产出静态 cost.hidden，没有把卡移入 Battlefield Facedown Zone 的动作。
//   * src/effects/contract.ts 的 ZoneDestination 没有 facedown；reference kernel 只能
//     落在既有区域（probe：把牌放到 battlefield 会变成正面永久物，不是背面位）。
//   * 因此“Hide 不开链”“手牌数 -1、bf1 背面位 +1、chain.count 仍为 0”都无法执行。
// 需要的机制：GameAction/ZoneDestination 的面朝下目的地与 Hide 自由动作（不含链）。
import test from "node:test";

test.todo(
  "privacy-hide-no-chain-preserves-privacy: Hide 不开链、身份从手牌私有无缝转为面朝下私有 " +
  "[M]（缺：Hide 自由动作与 Battlefield Facedown Zone 目的地，ZoneDestination 无 facedown）"
);

