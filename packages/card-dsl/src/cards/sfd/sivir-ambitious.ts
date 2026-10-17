import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sivir, Ambitious (sfd-120-221) — Unit, Body, tags Sivir/Shurima/Champion.
 * energy 6, power 3 (Body), Might 7.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-120-221，逐字，含换行）:
 *   "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or Ability.)\n"
 *   "When I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you may deal that much to an enemy unit."
 *
 * 规则依据（CR v1.5）：
 * - [Deflect 2]（809）：Passive Ability 关键词，809.1.b 规定带数值，809.1.c/809.1.c.1
 *   规定对手必须以任意域的 2 Power 支付才能用法术或能力选择我；809.2 规定多份 Deflect
 *   相加（stacking "sum"）。卡内只声明
 *   { kind: "keyword", keyword: "deflect", value: 2 }（契约 3.7/README 第 5 节），
 *   展开（target.tax 静态效果）由 effects/keywords/Deflect.ts 负责。
 * - "When I conquer after an attack"（383.4.c / 383.4.c.1 / 383.4.c.2.a）：Conquer
 *   Effect，时点 conquer，filter 内层锚点 source: "self" 指称本卡（"after an attack"
 *   指该次征服由一次攻击造成）。
 * - "if you assigned 5 or more excess damage to enemy units"（383.2.a.1）：紧跟触发
 *   条件的 "if" 从句是触发条件本身，进链前判定；"excess damage" 由 467.2.c.4 定义
 *   （超过致命所需的分配量），是本次战斗伤害分配的结果统计。
 * - "you may deal that much to an enemy unit"（403.1、契约 3.9）："you may" 是被选指令
 *   包进 choice.optional 的 body；"that much" 指前述已分配的 excess damage 总量；
 *   "an enemy unit" 是目标（355.10 / 355.9.a.1，"enemy" = 对手控制，740.1.b）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 触发条件「本次攻击向敌方单位分配 5+ excess damage」与效果的数额「that much」都依赖
 *   同一个未合入统计：没有可求值的路径读取本次战斗分配的 excess damage 总量——
 *   HistoryQuery（contract.ts）只有 scope/action/timingPoint/player/object 且返回事件
 *   **次数**（count），不是伤害量；conquer 时点（timing-points.ts）是 payloadType
 *   "scoring" 且未声明 payloadFields，也不携带战斗分配结果（同 ogn/tryndamere-barbarian
 *   与 unl/piltover-enforcer 记录的缺口）。
 * - conquer 时点有发射方（turn/flow.ts 在 scoring 时按 score.method 发射 conquer
 *   时点事件，载荷只有 player + details.battlefieldId）。过滤器用已有 conquered 别名，
 *   programs/filters.ts 会将内层 source: "self" 转为宿主 objectId，注册与校验已通过；
 *   但发射方尚未携带征服单位身份或参与该次攻击的信息，无法匹配「I conquer after an attack」。
 * - [Deflect 2] 的展开与 target.tax 消费方都已合入（chain/engine.ts 的 taxAdapter
 *   + mandatoryAdditional 接线），但税额仍接成 energy，尚未接为任意域 Power（809.1.c/809.1.c.1）。
 *   现有 power + 六域 allowedDomains 可表达 [A] 费用，不需要增加 Domain。
 * 依赖：excess damage 统计、征服宿主与攻击参与信息载荷、Deflect 的 Power 税额接线。
 * 不近似实现（不把条件写成常量、不把 "that much" 写成固定数额、不手改伤害或点数）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect", value: 2 },
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquered", filter: { source: "self" } },
      // 383.2.a.1：紧跟触发条件的 "if" 从句属于触发条件，进链前判定；
      // 467.2.c.4 的 excess damage 统计在合并内核里没有可求值路径（见 judgeReason）。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "excess-damage-assigned-this-combat",
          filter: { targetController: "opponent", scope: "this-attack" }
        },
        operator: "gte",
        right: { kind: "constant", value: 5 }
      }
    },
    optional: false,
    body: [
      {
        id: "sivir-ambitious.may-deal",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Deal the excess damage to an enemy unit?" },
          body: {
            kind: "constant",
            value: [
              {
                // 「that much」= 本次攻击向敌方单位分配的 excess damage 总量
                // （467.2.c.4）。现有 Expr 形态读不到该统计（HistoryQuery 只回事件次数），
                // 因此不写常量、也不借用 count；本指令按 lucian-gunslinger /
                // agonys-embrace 的既有写法声明缺失的读取位置，未接线时求值抛
                // MissingInformation、本指令被 ignored（fail-closed），而不是算错数额。
                id: "sivir-ambitious.read-excess-damage",
                op: "condition.value",
                args: {
                  value: {
                    kind: "object-property",
                    object: "source",
                    property: "excessDamageAssignedThisCombat"
                  },
                  key: { kind: "constant", value: "excessDamage" }
                }
              },
              {
                id: "sivir-ambitious.deal-that-much",
                op: "effect.damage",
                linkedTo: "sivir-ambitious.read-excess-damage",
                args: {
                  // "that much"：读取上一条指令链接出的统计值。
                  amount: {
                    kind: "linked-value",
                    instructionId: "sivir-ambitious.read-excess-damage",
                    key: "excessDamage"
                  },
                  target: { kind: "constant", value: "sivir-ambitious.enemy-unit" }
                },
                targets: [
                  {
                    id: "sivir-ambitious.enemy-unit",
                    // 740.1.b："enemy" = 对手控制；355.9.a.1："unit" 指 Board 上的单位。
                    filter: { type: "unit", controller: "opponent", zone: "board" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-4a74e3934f4bc0ee5d6d8c70c0b3f9df97cdfcc7c158bf1473bb64daa8aade48",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「if you assigned 5 or more excess damage to enemy units」与效果数额「that much」依赖同一个未合入统计：" +
    "没有任何可求值路径读取本次攻击向敌方单位分配的 excess damage 总量（CR 467.2.c.4 定义 excess = 超过致命所需的分配量）——" +
    "HistoryQuery（effects/contract.ts）只有 scope/action/timingPoint/player/object 且返回事件次数 count，不是伤害量；" +
    "conquer 时点是 payloadType \"scoring\" 且未声明 payloadFields，也不携带战斗分配结果（与 ogn/tryndamere-barbarian、" +
    "unl/piltover-enforcer 记录的同一缺口）。conquer 时点有发射方（turn/flow.ts 在 scoring 时按 score.method " +
    "发射 conquer 时点事件，载荷只有 player + details.battlefieldId）；本卡已改用 conquered 过滤别名，" +
    "绑定层将内嵌 source: \"self\" 转为 objectId，能够通过校验和真实事件管线注册。" +
    "仍缺征服宿主及参与该次攻击的信息载荷，无法按 383.4.c.2.a 判断「I conquer after an attack」。" +
    "[Deflect 2]（809）的展开 effects/keywords/Deflect.ts 已合入（target.tax 静态效果），" +
    "其消费方也已合入（chain/engine.ts 的 taxAdapter + mandatoryAdditional 接线），但税额仍接成 energy，" +
    "未接为 809.1.c/809.1.c.1 的任意域 Power。CR 135.2.e.5.a 的 [A] 费用已可由 power payment 配合六域 allowedDomains 表达。" +
    "正文里 excess damage 的读取位置（condition.value 读 source.excessDamageAssignedThisCombat）是待接线声明：" +
    "未接线时该指令求值抛 MissingInformation 并被 ignored，不会把数额算错。" +
    "依赖：excess damage 统计（CR 467.2.c.4）、征服宿主与攻击参与信息载荷、Deflect 的 Power 税额接线。" +
    "不近似实现（条件不写成常量、\"that much\" 不写成固定数额、不手改伤害）。",
  abilities,
  sourceText:
    "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or Ability.)\n" +
    "When I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you may deal that much to an enemy unit."
} satisfies CardProgram;

export default program;
