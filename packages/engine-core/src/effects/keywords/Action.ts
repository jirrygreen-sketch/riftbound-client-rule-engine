/**
 * Action —— 许可类关键词（Core Rules v1.5 806；另见 159.2.a 法术内在属性）。
 *
 * 806.1：Action 是许可类（Permissive）关键词，可存在于卡牌、符文能力、传奇能力或
 * 永久物能力上（806.1.a）。它授予对应卡牌/效果在 Showdown 期间被打出或启动的许可，
 * 即使不是其操控者的回合（806.1.b）。Action 在功能上等价于（806.1.c）：
 *   - 对卡牌：“此牌可在任意玩家的回合的 Showdown 期间打出。”
 *   - 对启动能力：“此能力可在任意玩家的回合的 Showdown 期间启动。”
 * 806.2：该许可不限于 Showdown——它包含该能力书写上或默认拥有的其他所有时机与选项。
 * 806.3：Action 不改变其所在卡牌/效果任何指令的功能，它仅仅是许可（例如带 Action 的
 *   单位仍受单位固有的打出位置限制——只能打到自己基地或自己控制的战场）。
 * 806.5：Action 是可引用特征——某游戏对象/法术/能力是否具有 Action 可被其他效果检查。
 *
 * 展开（P0 契约 3.7：速度类关键词展开为 `continuous.timing` 静态能力）：
 *   一个 `static` 能力，`effect.kind: "continuous.timing"`，由图层系统在 ability 层把
 *   “showdown 时机许可”授予宿主卡牌/能力；`chain/` 的 `canAct(player, speed)` 依据该
 *   持续效果给出的速度声明判定打出/启动是否合法。本关键词本身不写任何流程。
 *
 *   - 不带数值（806.1 未定义数值；印刷为 “[Action]”）→ `valued: false`。
 *   - 同名多个：806.2 明确许可“包含其他所有时机与选项”，806.3 说明它“仅仅是许可”——
 *     布尔式许可重复授予不产生叠加效果，故 `stacking: "single"`（v1.5 的数值相加合并
 *     只针对 Assault/Shield/Disarm 等数值类关键词，不适用于 Action）。
 *
 * 依赖尚未合入的部分（不近似实现，仅按契约写出展开结构）：
 *   - `continuous.timing` 持续效果的图层消费方尚未实现（P0 3.4 图层管线 / layers/ 目录
 *     目前只有占位 index.ts）；ability-templates 将其标为“高”优先级未实现模板。
 *   - `chain/` 的 `canAct(player, speed)` 时机许可查询（P0 3.5）尚未实现；Action 展开
 *     出的持续效果正是该查询读取的输入。
 *   - 因此本关键词的展开结果目前只能被 `validateCardProgram` 校验，暂无可执行的
 *     解释器/图层路径；一旦上述两者合入，本展开结构无需改动即可生效。
 */
import type { Ability } from "@riftbound/card-dsl";

import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * 展开为契约 3.1 `static` 能力：`continuous.timing` 授予 showdown 时机许可。
 * `value` 与 `host` 均不影响许可本身（806.1.c 的许可与数值、宿主身份无关），
 * 但签名遵循 `KeywordDef.expand` 契约。
 */
function expand(input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
  void input;
  return [
    {
      kind: "static",
      effect: {
        kind: "continuous.timing",
        grants: ["showdown"],
        appliesTo: ["card", "activated-ability"]
      }
    }
  ];
}

const action = {
  keyword: "Action",
  valued: false,
  stacking: "single",
  expand,
  ruleRefs: ["806.1", "806.1.b", "806.1.c", "806.2", "806.3", "806.5", "159.2.a"]
} satisfies KeywordDef;

export default action;
