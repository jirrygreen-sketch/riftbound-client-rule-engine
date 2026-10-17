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
 * 1. 禁止类持续效果已按契约 3.7 用已合入的 continuous.restrict 指令登记（
 *    原语把 restriction/actions 写进 ability 图层，layers/rules/query.ts 的
 *    restrictions() 能读回「action=play-spell 的禁止」），golden 已真实执行并验证登记结果。
 *    但整卡仍不可执行：链的时机许可查询 chain/engine.ts canAct 只读 Priority/Showdown/
 *    回合玩家的状态机，不读已登记的禁止声明，也没有把 355.8 / 806 / 159.2 的「能否打出」
 *    与 layers/rules/query.ts 的 restrictions() 接线的消费方——因此这条禁止在真实对局里不会阻止对手打出法术。
 * 2. 目的地不可表达：合并 IR 没有运行期 Location 选择器（target.location 属未合入原语），
 *    effect.move 的 to 只接受静态 LocationRef、controller-base 或静态候选列表；
 *    「occupied enemy battlefield」需要按 170.11.a 在合法战场中筛选并选择。本卡用描述性
 *    目的地标记（不是可执行地点），解释器会拒绝该形状而不是落到错误的地点
 *    （依赖进行中的 RIFT-357 location selection）。
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
    "两处当前依赖未合入，均不近似实现：(1)「Opponents can't play spells this turn」已用 continuous.restrict " +
    "登记进 ability 图层，layers/rules/query.ts 的 restrictions() 能读回该禁止，golden 有真实执行证据，" +
    "但链的打出/启动许可查询 chain/engine.ts canAct 只读 Priority/Showdown/回合玩家状态机，" +
    "不消费该禁止声明（355.8 / 806 / 159.2 的许可判定未接线到 layers/rules/query.ts 的 restrictions()），" +
    "因此禁止在真实对局里不生效。(2)「to an occupied enemy battlefield」的目的地是运行期 " +
    "Location 选择（CR 355.4 / 355.4.a / 451.1；occupied 见 170.11.a），合并 IR 没有运行期 Location 选择器" +
    "（target.location 未合入），effect.move 的 to 只接受静态 LocationRef / controller-base / 静态候选列表；" +
    "本卡只保留描述性目的地标记，解释器会拒绝它而不是落到错误地点（依赖进行中的 RIFT-357）。" +
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
