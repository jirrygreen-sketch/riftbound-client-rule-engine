/**
 * Reaction —— 许可类关键词（Core Rules v1.5 813；另见 159.2.b 法术内在属性）。
 *
 * 813.1：Reaction 是许可类（Permissive）关键词，可存在于卡牌、符文能力、传奇能力
 * 或永久物能力上（813.1.a）。它授予对应卡牌/效果 Action 的全部能力与许可（813.1.b），
 * 并额外在功能上等价于（813.1.c）：
 *   - 对卡牌：“此牌可在任意玩家的回合的 Closed State 期间打出。”
 *   - 对启动能力：“此能力可在任意玩家的回合的 Closed State 期间启动。”
 * 813.1.d：Reaction 在卡牌上格式为 “[Reaction]”，在能力上格式为 “[Reaction][>]”。
 * 813.2：该许可不限于 Closed State 或 Showdown——它包含该能力书写上、Action 许可或
 *   默认拥有的其他所有时机与选项。
 * 813.3：Reaction 不改变其所在卡牌/符文/效果任何指令的功能，它仅仅是许可（813.3.a：
 *   带 Reaction 的单位仍受单位固有的打出位置限制——只能打到自己基地或自己控制的战场）。
 * 813.5：Reaction 是可引用特征——某游戏对象/法术/能力是否具有 Reaction 可被其他效果检查。
 *
 * 展开（P0 契约 3.7：速度类关键词展开为 `continuous.timing` 静态能力）：
 *   一个 `static` 能力，`effect.kind: "continuous.timing"`，由图层系统在 ability 层把
 *   “closed-state 时机许可”授予宿主卡牌/能力，并隐含 Action 的 showdown 许可
 *   （813.1.b，Reaction 拥有 Action 的一切）；`chain/` 的 `canAct(player, speed)` 依据
 *   该持续效果给出的速度声明判定打出/启动是否合法（309.1.a：Closed State 中只有带
 *   Reaction 的卡牌/能力可被打出/启动；159.2.b.3：在 Closed State 打出的 Reaction 将
 *   先于链上已有项目结算）。本关键词本身不写任何流程。
 *
 *   - 不带数值（813.1 未定义数值；印刷为 “[Reaction]”）→ `valued: false`。
 *   - 同名多个：813.2 明确许可“包含其他所有时机与选项”，813.3 说明它“仅仅是许可”——
 *     布尔式许可重复授予不产生叠加效果，故 `stacking: "single"`（v1.5 的数值相加合并
 *     只针对 Assault/Shield/Disarm 等数值类关键词，不适用于 Reaction）。
 *
 * 依赖尚未合入的部分（不近似实现，仅按契约写出展开结构）：
 *   - `continuous.timing` 持续效果的图层消费方尚未实现（P0 3.4 图层管线 / layers/ 目录
 *     目前只有占位 index.ts）；ability-templates 将其标为“高”优先级未实现模板。
 *   - `chain/` 的 `canAct(player, speed)` 时机许可查询（P0 3.5）与 Closed/Open 状态机
 *     尚未实现；Reaction 展开出的持续效果正是该查询读取的输入。
 *   - 因此本关键词的展开结果目前只能被 `validateCardProgram` 校验，暂无可执行的
 *     解释器/图层路径；一旦上述两者合入，本展开结构无需改动即可生效。
 */
import type { Ability } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * 展开为契约 3.1 `static` 能力：`continuous.timing` 授予 closed-state 时机许可，
 * 并隐含 showdown（813.1.b：Reaction 拥有 Action 的全部许可）。
 * `value` 与 `host` 均不影响许可本身（813.1.c 的许可与数值、宿主身份无关），
 * 但签名遵循 `KeywordDef.expand` 契约。
 */
function expand(input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
  void input;
  return [
    {
      kind: "static",
      effect: {
        kind: "continuous.timing",
        grants: ["showdown", "closed-state"],
        appliesTo: ["card", "activated-ability"]
      }
    }
  ];
}

const reaction = {
  keyword: "Reaction",
  valued: false,
  stacking: "single",
  expand,
  ruleRefs: ["813.1", "813.1.b", "813.1.c", "813.2", "813.3", "813.5", "159.2.b"]
} satisfies KeywordDef;

export default reaction;
