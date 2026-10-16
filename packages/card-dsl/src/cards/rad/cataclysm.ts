import type { CardProgram } from "../../ir/index.js";

/**
 * Cataclysm（rad-084-167）— Spell，4 能量 + 1 Body 力量，领域 Body。
 *
 * 原文（packages/card-data/data/deck-catalog.json rad-084-167，逐字）：
 *   "Opponents can't play spells this turn.
 *    Move a friendly unit to an occupied enemy battlefield."
 *
 * 规则依据（CR v1.5）：
 * - 「Opponents can't play spells this turn」是本回合对对手打出咒语的持续禁止：能否
 *   打出属于 chain/ 的时机许可查询（355.8 / 806 / 159.2），本回合到期由时点驱动；
 *   调研表（docs/plans/survey/ability-templates.md 第 4 节）把「不能 / 必须 / 仅可」
 *   归到 continuous.restrict。
 * - 「Move a friendly unit to an occupied enemy battlefield」是效果移动（451；不是
 *   Standard Move 144，也不是 Recall 457）：被移动的友方单位是目标（355.10 /
 *   355.9.a.1），目的地是「被占据的敌方战场」（170.11.a：occupied = 该战场有单位在场）
 *   这一运行期 Location 选择（355.4 / 355.4.a / 451.1）。
 *
 * status = judge-required（不近似实现）：
 * 1. 禁止类持续效果没有消费方：effects/instructions 注册表里没有 continuous.restrict
 *    原语（只有 effect.* 与解释器控制指令），layers/ 目前只消费算术 / 关键词 / 移动图层，
 *    chain 的 canAct 也不读任何禁止声明（依赖 RIFT-91 layers-continuous 与链的许可查询）。
 * 2. 目的地不可表达：合并 IR 没有运行期 Location 选择器（target.location 属未合入原语），
 *    effect.move 的 to 只接受静态 LocationRef、controller-base 或静态候选列表；
 *    「occupied enemy battlefield」需要按 170.11.a 在合法战场中筛选并选择。本卡用描述性
 *    目的地标记（不是可执行地点），解释器会拒绝该形状而不是落到错误的地点
 *    （依赖 RIFT-90 目标/目的地计划、RIFT-91 图层过滤）。
 *
 * 两条子句是独立语句（两个句号），不写 linkedTo：禁止部分失败时移动仍按 055 /
 * 359.3.e.11 尽可能执行。
 */

/**
 * 描述性目的地标记，不是可执行 LocationRef：
 * effect.move 的 destination() 只接受 base/battlefield 字面量或候选列表，本形状会被
 * 直接拒绝（fail-closed），因此不会把单位移到错误的地点。
 */
const OCCUPIED_ENEMY_BATTLEFIELD = {
  kind: "destination-selector",
  filter: { type: "battlefield", occupied: true, controller: "opponent" }
} as const;

const cataclysm = {
  canonicalCardId: "card.hash-ae044cb9c1012d147e7d25ce802c5abdf9385203d5b3e53601d79a9d830f8472",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「Opponents can't play spells this turn」需要 continuous.restrict " +
    "这类持续禁止及其消费者——effects/instructions 没有该原语，layers/ 无消费方，chain 的 canAct 也不读禁止声明" +
    "（依赖 RIFT-91 layers-continuous 与链许可查询）。(2)「to an occupied enemy battlefield」的目的地是运行期 " +
    "Location 选择（CR 355.4 / 355.4.a / 451.1；occupied 见 170.11.a），合并 IR 没有运行期 Location 选择器" +
    "（target.location 未合入），effect.move 的 to 只接受静态 LocationRef / controller-base / 静态候选列表；" +
    "本卡只保留描述性目的地标记，解释器会拒绝它而不是落到错误地点（依赖 RIFT-90 / RIFT-91）。" +
    "被移动的友方单位已按 355.10 / 355.9.a.1 声明为目标。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 4 },
        // 印刷 1 点 Body Power（domains: ["Body"]）。
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 「Opponents can't play spells this turn」：描述性持续禁止声明，
          // continuous.restrict 未在 effects/instructions 注册（见 judgeReason）。
          id: "cataclysm.no-opponent-spells",
          op: "continuous.restrict",
          args: {
            mode: { kind: "constant", value: "prohibit" },
            action: { kind: "constant", value: "play-spell" },
            appliesTo: { kind: "constant", value: "opponent" },
            duration: { kind: "constant", value: "this-turn" }
          }
        },
        {
          // 「Move a friendly unit …」：effect.move 已合入，目标也已声明；只有
          // 目的地选择器缺失（描述性标记，见 judgeReason）。
          id: "cataclysm.move-unit",
          op: "effect.move",
          args: {
            objects: {
              kind: "constant",
              value: { target: "cataclysm.friendly-unit" }
            },
            to: { kind: "constant", value: OCCUPIED_ENEMY_BATTLEFIELD },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "cataclysm.friendly-unit",
              filter: { type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Opponents can't play spells this turn.\n" +
    "Move a friendly unit to an occupied enemy battlefield."
} satisfies CardProgram;

export default cataclysm;
