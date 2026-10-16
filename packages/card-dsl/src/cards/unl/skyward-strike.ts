import type { CardProgram } from "../../ir/index.js";

/**
 * Skyward Strike（unl-038-219）— Spell，2 能量 + 1 Calm 力量，领域 Calm。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-038-219，逐字）：
 *   "Move an enemy unit.\n" +
 *   "[Level 6][>] [Stun] an enemy unit. (While you have 6+ XP, get the effect. " +
 *   "A stunned unit doesn't deal combat damage this turn.)"
 *
 * 规则依据（CR v1.5）：
 * - 「Move an enemy unit」是效果移动（451；不是 Standard Move 144、不是 Recall 457）：
 *   被移动的敌方单位是目标（355.10 / 355.9.a.1，"enemy unit" 见 133.3 的特征指称），
 *   原文没有印刷目的地，目的地按 355.4 / 355.4.a 在 Finalize 时选择「另一个该单位可存在
 *   的地点」（451.1 的合法性由移动来源给出）。
 * - 「[Level 6][>] …」是 824.1 的依赖式关键词（Dependent Keyword）：824.1.b 规定从关键词
 *   到子句结尾整段是 Level Ability，824.1.b.1 的功能等价文本是「当你有 6 点或更多 XP 时，
 *   本牌获得 “[Text]”」；824.1.c/824.1.c.1/824.1.d 要求按控制者 XP 动态 Active/Inactive。
 *   契约 3.7 的 KeywordDef 展开属 kw-level（尚未合入），卡内不手写一套相同逻辑；
 *   下面用「该指令带 6+ XP 条件」的形状保留依赖能力的绑定范围。
 * - 「[Stun] an enemy unit」是 Stun 游戏动作（424.1；"a unit" 类选择按 355.5 是 Choice →
 *   目标），reminder 的「doesn't deal combat damage this turn」是 424.1.b/424.1.a.2 的
 *   状态结果，不是独立指令。
 *
 * status = judge-required（README 第 2 节），两处依赖未合入，均不近似实现：
 * 1. Move 的目的地是运行期 Location 选择（355.4 / 355.4.a / 451.1）：合并 IR 没有运行期
 *    Location 选择器（target.location 未合入），effect.move 的 to 只接受静态 LocationRef /
 *    controller-base / 静态候选列表；本卡只保留描述性目的地标记，它不是可执行 LocationRef
 *    （fail-closed，不会把单位移到臆造的地点）。
 * 2. 6+ XP 谓词不可求值：合并 IR 的 Condition 只有 always/never/expression/compare/all/any/not，
 *    读取 PlayerSnapshot.xp 没有进入 Expr/谓词的路径（同 unl/wuju-master 的记录）；
 *    kw-level 的依赖式展开与 824.1.c.1/.d 的动态失活同样未合入。
 * 依赖：RIFT-90（目标/目的地计划）、RIFT-89/90（XP 条件与谓词管线）、kw-level 展开。
 */

/** 描述性目的地标记，不是可执行 LocationRef（见 judgeReason 第 1 点）。 */
const CHOSEN_LOCATION = {
  kind: "destination-selector",
  filter: { type: "location" }
} as const;

const skywardStrike = {
  canonicalCardId: "card.hash-62a9f2d639b7330735e8fe37e90125f696cee6bef52e5005de3b0701be88e001",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「Move an enemy unit」没有印刷目的地——目的地按 CR 355.4 / 355.4.a / 451.1 在" +
    "结算时选择，合并 IR 没有运行期 Location 选择器（target.location 未合入），effect.move 的 to 只接受静态 LocationRef / " +
    "controller-base / 静态候选列表；本卡只保留描述性目的地标记（依赖 RIFT-90）。(2)「[Level 6][>] [Stun] an enemy unit」" +
    "是 824.1 的依赖式关键词：6+ XP 谓词在合并 IR 里没有可求值路径（Condition 只有 always/never/expression/compare/" +
    "all/any/not，PlayerSnapshot.xp 未进入 Expr；同 unl/wuju-master），kw-level 的展开与 824.1.c.1/.d 的动态失活也未合入" +
    "（依赖 RIFT-89/90 与 kw-level）。Stun 本体（424.1）声明的目标是敌方单位；reminder 的 “doesn't deal combat damage" +
    " this turn” 是 424.1.b/424.1.a.2 的状态结果，不写成独立指令。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        // 印刷 1 点 Calm Power（domains: ["Calm"]）。
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "skyward-strike.move-enemy-unit",
          op: "effect.move",
          args: {
            objects: {
              kind: "constant",
              value: { target: "skyward-strike.enemy-unit" }
            },
            to: { kind: "constant", value: CHOSEN_LOCATION },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "skyward-strike.enemy-unit",
              filter: { type: "unit", controller: "opponent", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "skyward-strike.stun-enemy-unit",
          // 824.1.b.1 的「当你有 6+ XP 时，本牌获得 [Stun] an enemy unit」：条件从句只作用
          // 于本条指令（契约 3.4），依赖能力的范围因此与印刷的 Level 子句一致。
          // 该 XP 条件当前不可求值（见 judgeReason 第 2 点）。
          op: "effect.stun",
          args: { target: { kind: "constant", value: "skyward-strike.stunned-unit" } },
          targets: [
            {
              id: "skyward-strike.stunned-unit",
              filter: { type: "unit", controller: "opponent", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "controller-xp",
              filter: { player: "controller" }
            },
            operator: "gte",
            right: { kind: "constant", value: 6 }
          }
        }
      ]
    }
  ],
  sourceText:
    "Move an enemy unit.\n" +
    "[Level 6][>] [Stun] an enemy unit. (While you have 6+ XP, get the effect. " +
    "A stunned unit doesn't deal combat damage this turn.)"
} satisfies CardProgram;

export default skywardStrike;
