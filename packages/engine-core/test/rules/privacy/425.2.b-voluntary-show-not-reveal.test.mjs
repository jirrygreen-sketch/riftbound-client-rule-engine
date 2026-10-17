// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-voluntary-show-not-reveal-no-trigger (CR v1.5 425.2.b)
//
// 状态：test.todo。缺什么：玩家主动“出示”命令。
//   * 425.2.b 是玩家的自由出示：不构成 Reveal、不触发“当牌被展示时”、受众可指定。
//   * 新内核的 GameAction 只有 reveal（对所有人）与 show-off（Show Off 特征快照，
//     src/effects/contract.ts），没有“主动 show 给指定玩家”的动作；也没有玩家命令层
//     （见 privacy-reveal-only-when-instructed 的 todo）。
//   * src/projection/v2 的 safeEvent 认识 card.shown 事件类型，但没有内核路径产出它，
//     所以无法执行“B 看到、观战看不到、不触发 draw”的断言。
// 需要的机制：show GameAction（受众为玩家集合）与对应命令准入。
import test from "node:test";

test.todo(
  "privacy-voluntary-show-not-reveal-no-trigger: 主动向 B 出示手牌不产生 card.revealed、不触发展示触发 " +
  "[M]（缺：指定受众的 show 动作与命令入口，GameAction 只有 reveal/show-off）"
);

