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
 * status = judge-required（2026-10-16 复核：缺口不近似实现）：
 * - 触发条件 "if you assigned 3 or more excess damage" 仍无可求值路径：conquer 时点载荷
 *   （events/timing-points.ts：payloadType "scoring"，未声明 payloadFields）不带本次战斗
 *   分配的超量伤害，ResolveContext 也没有读取伤害分配台账的入口（467.2.c.1 强调 Assigning
 *   与 Dealing 是两件事），契约 3.6 的 history 只按动作次数计数、不能表达金额；本程序的
 *   count subject 只是保留形状（探针：4 个无关对象即让 compare 成立）。
 * - 触发注册还差词汇翻译：RIFT-257 的 programs/triggers.ts 会把卡面 filter 交给
 *   translateTriggerFilter + validateTriggerSpec，而封闭词汇要求 "conquered"/"held"；本卡写的
 *   "conquer" 会在 registerTrigger 抛 TriggerSpecValidationError（探针确认），RIFT-270 的 conquer
 *   波也不带事件对象，383.4.c.2.a 要求的“在场单位”载荷绑定无法验证。
 * - "play two Gold gear tokens exhausted" 仍无可执行路径：effect.token 的冻结定义表没有 gold
 *   （187.5 的 Gold gear token 带自身能力，按该原语文档保持 blocked，探针确认返回
 *   negated/blockedReason 而不是创建替代物）。mode "play" 的链上创建 + 打出本身对已定义 token
 *   可用（golden 用 recruit 真实执行 2 张），但链侧 effect Play 要求被打出对象有已注册的
 *   CardProgram（chain/engine.ts routeAction + describePlay），token 无 cardId，会抛 “Effect Play
 *   requires a card-program for a token”（探针确认）。184.1 / 185.2.d 的入场状态改写同样没有
 *   IR 参数（写入额外键会被 argsSchema 拒绝）。
 *
 * 依赖：RIFT-257 后续（触发词汇翻译与 token 的 play 交接接线）、Gold 定义（187.5）、入场状态
 * 改写、引擎批 4/5 的 conquer 事件载荷与伤害分配回执。
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
    "三处缺口未合入，均不近似实现：(1) 触发条件「if you assigned 3 or more excess damage」无可求值路径——" +
    "conquer 时点载荷（timing-points.ts：payloadType \"scoring\"，未声明 payloadFields）不带本次战斗的伤害分配总量/超量，" +
    "ResolveContext 也没有读取伤害分配台账的入口（467.2.c.1 的 Assigning 与 Dealing 是两件事），契约 3.6 的 history 只按动作计数、" +
    "不能表达金额；程序里的 count subject 只是保留形状（探针：4 个无关对象即让 compare 成立）。" +
    "(2) 触发注册还差词汇翻译：RIFT-257 的 programs/triggers.ts 用 translateTriggerFilter + validateTriggerSpec 翻译卡面 filter，" +
    "封闭词汇要求 \"conquered\"/\"held\"，本卡写的 \"conquer\" 会在 registerTrigger 抛 TriggerSpecValidationError（探针确认），" +
    "且 RIFT-270 的 conquer 波不带事件对象，383.4.c.2.a 的“在场单位”载荷绑定无法验证。" +
    "(3) 「play two Gold gear tokens exhausted」无可执行路径：effect.token 的冻结定义表没有 gold" +
    "（187.5 的 Gold gear token 带自身能力 [Reaction][>] Kill this, [E]: [Add] [A]，按该原语文档保持 blocked，" +
    "探针确认返回 negated/blockedReason），184.1 / 185.2.d 的“exhausted”入场状态改写没有 IR 参数（写入额外键会被 argsSchema 拒绝），" +
    "先创建再补一次横置会产生错误的“成为横置”事件；另外链侧 effect Play 要求被打出对象有已注册 CardProgram" +
    "（chain/engine.ts routeAction + describePlay），token 无 cardId，会抛 “Effect Play requires a card-program for a token”（探针确认）。" +
    "依赖：RIFT-257 后续（触发词汇翻译与 token play 交接接线）、Gold 定义（187.5）、入场状态改写、引擎批 4/5 的 conquer 事件载荷与伤害分配回执。",
  abilities,
  sourceText:
    "When I conquer, if you assigned 3 or more excess damage, play two Gold gear tokens exhausted. " +
    '(They have "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")'
} satisfies CardProgram;
