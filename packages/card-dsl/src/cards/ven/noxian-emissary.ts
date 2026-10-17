import type { CardProgram } from "../../ir/index.js";

/**
 * Noxian Emissary (ven-128-166) — Unit, 2 Energy, 2 Might, Order, Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-128-166，逐字）：
 *   [Empower] :rb_energy_1::rb_rune_order: (:rb_energy_1::rb_rune_order::
 *   Empower me. Use only if not Empowered.)
 *   [Empowered][>][>>][Deathknell][>] Play two 1 :rb_might: Recruit unit tokens
 *   to your base. (When I die while Empowered, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - 827.1/827.1.c.1：[Empower] 是启动能力关键词，功能等价于
 *   “[1 Energy + 1 Order Power]：Empower me。仅当未 Empowered 时启动。”
 *   827.1.b 说明 Empower 的来源自身不是目标；827.2/827.2.a 规定动作完成后宿主
 *   成为 Empowered 并产生可引用事件。
 * - 828.1.a/828.1.b.1：[Empowered][>] 是依赖型关键词；从关键词到子句末尾整段是
 *   Empowered 能力，功能等价于“当我拥有 Empowered 状态时，此牌获得 [Text]”。
 * - 727.1.b.3：[Empowered][>>][Deathknell] 是依赖关键词叠加——只有当 Empowered
 *   条件成立时，后面的 Deathknell 能力才 Active。[Empowered] 在此不作为独立关键词
 *   声明，否则会错误地表达为“本牌始终拥有 Deathknell”。
 * - 808.1.c：Deathknell 功能等价于 “When I die, [Effect].”；触发在对象被消灭时
 *   入链（object-killed，429.1.a.1.b），并从换区前的最后已知信息读取
 *   （808.1.d.3）。本程序把该依赖能力写成显式触发能力，并在过滤里保留
 *   `empowered: true` 的依赖门槛。
 * - 187.1：Recruit 是 1 Might 的单位 token；契约 3.6 的 create-token 只允许单位
 *   进入控制者自己的 Base，对应原文 “to your base”。
 *
 * status = judge-required：Empower/Empowered 的关键词展开和印刷费用绑定仍缺，
 * Empowered 状态还不能由 Condition 或死亡前的最后已知快照查询，因此无法判定
 * 727.1.c.1 / 828.1.b.1 的依赖能力。object-killed 生产、trigger 注册与 LKI 捕获已经存在，
 * 不再把通用 Deathknell 展开的 trigger.leave 缺口当成本显式死亡触发的依赖。
 * effect.token 的 mode play 半段由 golden 真实执行。
 */
export default {
  canonicalCardId: "card.hash-f94f709693f78579dcd97c1ebdba7859c74403424ef6cd195238e47541869fbf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) Empower/Empowered 关键词的展开和印刷的 1 Energy + 1 Order Power 费用绑定仍不可用（827.1.c.1 / 828.1.b.1）。" +
    "(2) Condition 与 ObjectSnapshot 没有可查询的 Empowered 状态，无法在宿主死亡前的最后已知信息上判定依赖能力是否 Active（442.1.a、727.1.c.1、808.1.d.3）；描述性 empowered:true 不能代替该门控，需 RIFT-359 条件谓词及状态查询支持。" +
    "object-killed 的事件生产、触发注册和 LKI 捕获已可用，effect.token（mode play）已真实执行；不近似实现。",
  abilities: [
    {
      // 印刷费 1 Energy + 1 Order Power 见 judgeReason；KeywordAbility 没有 params
      // 字段（契约 3.8.3 的 params 只加在 KeywordDef.expand 的输入上），不伪造第二条
      // 启动能力，与 ven-149-166 Defender of Tomorrow 的写法一致。
      kind: "keyword",
      keyword: "empower"
    },
    {
      // [Empowered][>>][Deathknell][>] 的依赖能力：过滤里的 `empowered: true` 是
      // 442.1.a 的 Empowered 状态门槛（727.1.b.3），尚无谓词消费者。
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: { self: true, empowered: true, cause: "kill", destination: "trash" }
      },
      optional: false,
      body: [
        {
          id: "noxian-emissary.play-two-recruits",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 2 },
            // 440.2.c / 185.2.a：被“打出”的 token 先在链上生成再交给打出流程。
            mode: { kind: "constant", value: "play" },
            // “to your base”：唯一合法的单位 Base 目的地是控制者自己的 Base；
            // `player: "controller"` 是由消费方在结算时解析的静态占位符
            // （静态 IR 不知道运行时 PlayerId）。
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Empower] :rb_energy_1::rb_rune_order: (:rb_energy_1::rb_rune_order:: Empower me. " +
    "Use only if not Empowered.)\n[Empowered][>][>>][Deathknell][>] Play two 1 :rb_might: " +
    "Recruit unit tokens to your base. (When I die while Empowered, get the effect.)"
} satisfies CardProgram;
