// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-hidden-reaction-grant-not-public (CR v1.5 811.6, 811.6.a)
//
// 状态：test.todo。缺什么：811.6 的“次回合获得 Reaction”授权及其不可公开的投影表示。
//   * src/effects/keywords/Hidden.ts 只展开 cost.hidden 静态声明，头注释列出未合入依赖：
//     cost.hidden 的 Hide/面朝下权限、continuous.timing 的“next turn Reaction 许可”
//     （RIFT-89/91）。
//   * src/effects/contract.ts 的 ObjectSnapshot 没有 speed / hiddenOnTurn 字段；
//     src/projection/v2 的类型虽接受这两个字段，但没有内核路径产出它们
//     （probe49 实测：面朝下对象投影出的 speed/hiddenOnTurn 均为 undefined，
//     连控制者视角也没有授权信息）。
// 需要的机制：Hidden 的次回合 Reaction 授权（continuous.timing，不公开）+ 投影只让
// 控制者读到该授权（811.6.a“不是公开信息”）。
import test from "node:test";

test.todo(
  "privacy-hidden-reaction-grant-not-public: 面朝下牌次回合的 Reaction 授权只对控制者可见 " +
  "[M]（缺：811.6 的次回合 Reaction 授权与 ObjectSnapshot/投影的 hiddenOnTurn 表示）"
);

