import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Yeti Brawler (unl-018-219) — Unit, 6 Energy, Might 6, Fury, tag Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-018-219，逐字）：
 *   "When I conquer, if you assigned 3 or more excess damage, play two Gold gear
 *    tokens exhausted. (They have \"[Reaction][>] Kill this, :rb_exhaust:: [Add]
 *    :rb_rune_rainbow:.\")"
 *
 * 规则依据（CR v1.5）：
 * - 383.4.c / 383.4.c.1："When I conquer" 是 Conquer Effect，时点用封闭表的 conquer
 *   （scoring/ 发出，ruleRefs 468.5.d / 471.1 / 473.2.a）。
 * - 383.2.a.1：紧跟触发条件之后的 "if you assigned 3 or more excess damage" 属于触发条件
 *   本身，在触发时求值；467.2.c 规定战斗伤害按分配行动处理，467.2.c.2 定义 Lethal Damage、
 *   467.2.c.4 是"超出致命所需"的分配限制，因此该条件是本次战斗的伤害分配结果统计。
 * - "play two Gold gear tokens exhausted"：
 *   · 187.5 定义 Gold gear token：无域 gear token，带自身能力 "[Reaction][>] Kill this,
 *     [E]: [Add] [A]"（括号内的提醒文本即该 token 的能力，不是本卡的独立指令）；
 *   · 350.2 / 440.2.c / 185.2.a：被"打出"的新 token 先在链上创建、再由 play 接手；
 *   · 184.1 / 185.2.d："exhausted" 是入场状态改写（与 143.4 的默认横置进场相对），
 *     不是先创建再补一次横置。
 *
 * status = judge-required（缺口不近似实现）：
 * - 触发条件 "if you assigned 3 or more excess damage" 无可求值路径：conquer 时点载荷
 *   （events/timing-points.ts：payloadType "scoring"，未声明 payloadFields）不带本次战斗
 *   分配的超量伤害，ResolveContext 也没有读取伤害分配台账的入口（467.2.c.1 强调 Assigning
 *   与 Dealing 是两件事），契约 3.6 的 history 只按动作次数计数、不能表达金额。
 * - "play two Gold gear tokens exhausted" 无可执行路径：effect.token 的冻结定义表没有 gold
 *   （187.5 的 Gold gear token 带自身能力，按该原语文档保持 blocked，本条会返回
 *   negated/blockedReason 而不是创建替代物）；184.1 / 185.2.d 的入场状态改写同样不被支持。
 *
 * 依赖：RIFT-62（create-token to chain 与 effect.play 交接）、Gold 定义（187.5）、入场状态
 * 改写、引擎批 4/5 的 conquer 事件载荷与伤害分配回执、RIFT-120（卡牌触发注册）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquer", player: "self" },
      // 383.2.a.1："if you assigned 3 or more excess damage" 是触发条件的一部分。
      // count 表达式保留条件形状；合并 IR 没有伤害分配金额维度，见 judgeReason。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "excess-damage-assigned-this-combat",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 3 }
      }
    },
    optional: false,
    body: [
      {
        id: "yeti-brawler.play-gold",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "gold" },
          // "two Gold gear tokens"：印刷数额 2（187.5 的 token 定义）。
          amount: { kind: "constant", value: 2 },
          // "play …"：440.2.c / 185.2.a 要求先在链上创建再交给打出流程。
          mode: { kind: "constant", value: "play" },
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          linkKey: { kind: "constant", value: "goldTokens" }
          // "exhausted" 的入场状态改写（184.1 / 185.2.d）：create-token 尚不支持，
          // 不新增 IR 参数键、也不先创建再补一次横置（见 judgeReason）。
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-372a2d2a0b9116fc9b30d8a6f4899848963d12a45cf804935f7f8f9d355c80be",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1) 触发条件「if you assigned 3 or more excess damage」无可求值路径——conquer 时点载荷" +
    "（timing-points.ts：payloadType \"scoring\"，未声明 payloadFields）不带本次战斗的伤害分配总量/超量，" +
    "ResolveContext 也没有读取伤害分配台账的入口（467.2.c.1 的 Assigning 与 Dealing 是两件事），" +
    "契约 3.6 的 history 只按动作计数、不能表达金额，467.2.c.2/c.4 的 Lethal Damage 与“超出致命所需的分配量”" +
    "因此无法表达。" +
    "(2) 「play two Gold gear tokens exhausted」无可执行路径：effect.token 的冻结定义表没有 gold" +
    "（187.5 的 Gold gear token 带自身能力 [Reaction][>] Kill this, [E]: [Add] [A]，按该原语文档保持 blocked），" +
    "mode \"play\" 需要先在链上创建再交给打出流程（440.2.c / 185.2.a / 350.2 / 354），而 184.1 / 185.2.d 的" +
    "“exhausted” 入场状态改写不被 create-token 支持，先创建再补一次横置会产生错误的“成为横置”事件。" +
    "依赖：RIFT-62（create-token to chain 与 effect.play 交接）、Gold 定义（187.5）、入场状态改写、" +
    "引擎批 4/5 的 conquer 事件载荷与伤害分配回执、RIFT-120（卡牌触发注册）。不近似实现。",
  abilities,
  sourceText:
    "When I conquer, if you assigned 3 or more excess damage, play two Gold gear tokens exhausted. " +
    '(They have "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")'
} satisfies CardProgram;
