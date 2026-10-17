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
 * status = executable（2026-10-17 复核）：
 * - continuous.restrict 已登记到 ability 图层，且 ChainEngine.actionIsRestricted 会通过
 *   layers/rules/query.ts 的 restrictions() 阻止对手打出法术（355.8 / 806 / 159.2）。
 * - occupied enemy battlefield 已使用当前 LocationTargetSpec + LocationExpr 选择器，
 *   在结算时从合法战场集合中选择，并由 effect.move 读取同一地点。
 *
 * 两条子句是独立语句（两个句号），不写 linkedTo：禁止部分失败时移动仍按 055 /
 * 359.3.e.11 尽可能执行。
 */

/**
 * 目的地由同一条指令的 LocationTargetSpec 在结算时选择；target-location 读取该绑定，
 * 因而不会把单位移到静态或猜测地点。
 */
const cataclysm = {
  canonicalCardId: "card.hash-ae044cb9c1012d147e7d25ce802c5abdf9385203d5b3e53601d79a9d830f8472",
  rulesetVersion: "core-1.5",
  status: "executable",
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
          // 「Opponents can't play spells this turn」（355.8 / 806 / 159.2）：用已合入的
          // continuous.restrict 登记 ability 图层的本回合禁止；
          // appliesTo 是被禁止玩家的对象过滤（190.6.c 的 opponent = 相对能力控制者），
          // 由 layers/rules/query.ts 的 restrictions() 按 filter 还原成具体玩家。
          id: "cataclysm.no-opponent-spells",
          op: "continuous.restrict",
          args: {
            mode: { kind: "constant", value: "prohibit" },
            action: { kind: "constant", value: "play-spell" },
            appliesTo: { kind: "constant", value: { controller: "opponent" } },
            duration: { kind: "constant", value: "this-turn" }
          }
        },
        {
          // 「Move a friendly unit …」：在运行期选择被占据的敌方战场，并将
          // 友方目标移动到同一地点。
          id: "cataclysm.move-unit",
          op: "effect.move",
          locations: [
            {
              id: "cataclysm.occupied-enemy-battlefield",
              type: "battlefield",
              controller: "opponent",
              occupied: true,
              min: 1,
              max: 1,
              selection: "one"
            }
          ],
          args: {
            objects: {
              kind: "constant",
              value: { target: "cataclysm.friendly-unit" }
            },
            to: {
              kind: "location",
              value: {
                kind: "target-location",
                target: "cataclysm.occupied-enemy-battlefield"
              }
            },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "cataclysm.friendly-unit",
              filter: { type: "unit", controller: "self" },
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
