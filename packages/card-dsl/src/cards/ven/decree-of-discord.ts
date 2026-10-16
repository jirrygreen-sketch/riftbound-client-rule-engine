import type { CardProgram } from "../../ir/index.js";

/**
 * Decree of Discord (ven-107-166) — Spell, 1 energy + 1 Chaos power, no tags.
 * Might null（法术无印刷 Might，绝不改写成 0）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-107-166，逐字）:
 *   "Return any number of enemy Order (:rb_rune_order:) units with total Might 5 or less to their owners' hands."
 *
 * 规则依据（CR v1.5）：
 * - "Return … to their owners' hands" 是区域移动：108.7.a/108.7.f 的 Hand 属于牌主，
 *   355.9 的示例明确 "Return a unit from your trash to your hand" 是指名对象的返回动作；
 *   已合入的 effect.zone 提交封闭 GameAction `return-to-hand`（to: "hand"），由内核按
 *   127.1 的 Owner 把牌放进其主人的手牌（已合入的 ogn/gust、ogn/retreat 采用同一写法）。
 * - "any number of enemy Order units" 是玩家做出的选择（355.7/355.10），因此写成 TargetSpec；
 *   "any number" 允许选 0 个（355.13），所以为 min 0 / selection "any"，而不是 min 1。
 * - "enemy" 是能力控制者的对手（740.1.b）：controller: "opponent"，由链的 query 归一化解析。
 * - "with total Might 5 or less" 是**分组目标约束**（355.11：整组目标共同满足的限制；
 *   355.11.a 在 Finalize 选组、355.11.b 在结算时改选合法子集）。
 * - "Order" 是领域（134）而不是类型：对象的领域由 ObjectSnapshot.power 承载。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。两处依赖未合入，均不近似实现：
 * (1) 分组总 Might 约束没有可执行路径：已合入的 target-plan 只有 min/max 与逐成员合法性，
 *     `kind: "group"` 字段没有消费方，也没有 355.11.b/355.11.b.1 的结算时合法子集重选
 *     （CR 355.11 的示例正是同型卡 Fox-Fire；依赖 RIFT-90 / RIFT-9 的 target.group）。
 * (2) "Order" 领域谓词没有消费方：已合入的过滤器匹配器（layers/filter.ts matchesObjectFilter、
 *     events/pipeline-match.ts）只读取固定键，不读取 power/domain；程序里的 power: ["Order"]
 *     只是待接线声明，不能当作已执行的限制（依赖 RIFT-90 的目标谓词词表）。
 * 已支持并真实执行的部分：effect.zone 的 return-to-hand 半段（含 owner 路由与目标失效分支）。
 */
const decreeOfDiscord = {
  canonicalCardId: "card.hash-4691711da635261037a803f4f36b852363c66f425acc01fe7259b51e4045a69e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「with total Might 5 or less」是 355.11 的分组目标约束" +
    "（整组目标合计 ≤ 5；355.11.a 在 Finalize 选组、355.11.b 在结算时改选合法子集），" +
    "已合入的 target-plan 只有 min/max 与逐成员合法性，kind: \"group\" 没有消费方，" +
    "也没有结算时的合法子集重选（依赖 RIFT-90 / RIFT-9 的 target.group）。" +
    "(2)「Order」是领域（134，由 ObjectSnapshot.power 承载），已合入的过滤器匹配器" +
    "（layers/filter.ts、events/pipeline-match.ts）只读取固定键，不读取 power/domain，" +
    "程序里的 power: [\"Order\"] 只是待接线声明，没有消费方（依赖 RIFT-90 的目标谓词词表）。" +
    "已支持部分：effect.zone 的 return-to-hand 半段（108.7/355.13 的 any number、127.1 的 owner 路由）" +
    "由 golden 用真实解释器 + 参考内核执行；any number 允许 0 个目标，故 min 0 / selection \"any\"。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // "Return any number of enemy Order units … to their owners' hands"：
          // 被点名的单位是目标（355.7/355.9.a.1），any number 可为零（355.13）。
          id: "decree-of-discord.return-units",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "decree-of-discord.enemy-order-units" },
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "decree-of-discord.enemy-order-units",
              filter: {
                type: "unit",
                zone: "board",
                controller: "opponent",
                // 134 的 Order 领域：待接线的谓词键，见 judgeReason 第 2 点。
                power: ["Order"]
              },
              min: 0,
              max: null,
              selection: "any",
              // 355.11 的分组约束标记：整组合计 Might ≤ 5（与 rad/scorched-earth 的
              // group 标记同一形状）。该字段当前没有消费方，见 judgeReason 第 1 点。
              group: true
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Return any number of enemy Order (:rb_rune_order:) units with total Might 5 or less to their owners' hands."
} satisfies CardProgram;

export default decreeOfDiscord;
