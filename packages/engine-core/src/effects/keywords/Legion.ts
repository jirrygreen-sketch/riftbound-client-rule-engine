import type { Ability, StaticAbility } from "@riftbound/card-dsl";

import type { KeywordDef } from "../keyword-contract.js";

/**
 * Legion —— v1.5 规则 812（依赖型关键词 Dependent Keyword）。
 *
 * 规则依据（Core Rules v1.5，/root/swarm-rift/shared/rules/CR-v1.5.txt）：
 * - 812.1 / 812.1.a：Legion 是依赖型关键词，格式为 "[Legion][>] [Text]"，从关键词到子句
 *   结束的整个语句是 Legion 能力（812.1.b），[Text] 是依赖能力（812.1.b.2）。
 * - 812.1.b.1：功能上等同于 "If you have played another card this turn, this card gains
 *   [Text]."，即条件为「你本回合已打出过另一张（非本卡的）牌」。
 * - 812.1.c：只要**与本卡不同**的牌在同一回合被你 Finalized，依赖能力即在本卡上激活。
 * - 812.2：你打出的**一张**牌即可同时满足你控制的所有 Legion 实例——同一对象上多个
 *   Legion 实例共享同一条历史条件，不重复计数、不求和，条件只成立一次，因此
 *   stacking: "single"（对照 807.2 的 Assault 求和仅适用于带数值的被动关键词）。
 * - 812.3：Legion 及其持有状态是牌的特征，可被其他游戏效果检查或引用。
 *
 * 关键词与效果正文的边界（契约 3.7）：Legion 是条件类关键词，展开为一个**条件谓词**
 * 静态能力，供卡牌程序在静态 / 启动 / 触发能力的 condition 字段中引用（linked-value
 * 表达式读取本谓词写下的链接值 active）。关键词本身不写任何流程；[Text]（依赖能力
 * 正文，例如 "I cost [2] less."、"You may play me from your trash for [3][C]."）由卡牌
 * 程序携带，不属于本展开。
 *
 * 历史条件的建模：谓词经 condition.history 查询本回合由该控制者完成的 play 动作数
 * （HistoryQuery.scope = "turn"，见 ResolveContext.history 与契约 3.6 的 history 查询；
 * 本回合打出历史正是 condition.history 原语族的设计用途）。规则要求排除本卡自身
 * （812.1.c "a card different than the one with the Legion ability"），排除依据为
 * host.canonicalCardId，写在谓词载荷 excluding 中。
 *
 * 依赖尚未合入的部分（均按计划由其他任务实现，本文件只按契约引用其 id，不近似实现）：
 * - condition.history / condition.predicate 原语：历史计数与谓词求值（RIFT-9 调研
 *   ability-templates.md，Flow / Legion 共用，本展开仅引用其 op / ContinuousEffect 形状）。
 * - 事件历史按 canonicalCardId 排除的 excluding 维度：当前封闭 HistoryQuery 结构
 *   （scope/action/timingPoint/player/object）没有"按卡身份排除"的字段；812.1.c 的
 *   "另一张牌"在 M1 场景下需要它。属于契约级缺口，见本任务最终回复的契约变更请求。
 *   在管线支持前，依赖 Legion 的卡牌程序保持 judge-required，不得近似放行。
 */
const legion = {
  keyword: "Legion",
  valued: false,
  stacking: "single",
  expand({ host }) {
    const predicateId = `legion:${host.canonicalCardId}:predicate`;
    const ability: StaticAbility = {
      kind: "static",
      effect: {
        kind: "condition.predicate",
        id: predicateId,
        link: "active",
        history: {
          scope: "turn",
          action: "play",
          player: "controller",
          excluding: host.canonicalCardId
        },
        operator: "gte",
        right: 1
      },
      condition: { kind: "always" }
    };
    return [ability] as readonly Ability[];
  },
  ruleRefs: [
    "812",
    "812.1",
    "812.1.a",
    "812.1.b",
    "812.1.b.1",
    "812.1.b.2",
    "812.1.c",
    "812.2",
    "812.3"
  ]
} satisfies KeywordDef;

export default legion;

