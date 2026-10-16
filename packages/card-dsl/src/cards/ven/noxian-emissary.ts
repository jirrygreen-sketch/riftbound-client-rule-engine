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
 * status = judge-required（四处缺口均不近似实现）：
 * 1. keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，
 *    827.1.c.1 的启动费用与“仅当未 Empowered 时”限制、828.1.b.1 的依赖能力都
 *    无法展开（RIFT-81~88 批次不含它们）；
 * 2. 没有 Empowered 状态谓词：442.1.a 的二元状态不在 ObjectSnapshot / Condition
 *    里，触发过滤里的 `empowered: true` 只是描述性记录（严格触发器校验会以
 *    unknown-field 拒绝，golden 已断言）；
 * 3. effects/keywords/Deathknell.ts 展开出的触发能力引用 trigger.leave 原语，但
 *    effects/instructions/ 下没有该文件（与 RIFT-154 的 kogmaw-caustic 同型缺口）；
 * 4. 727.1.c.1 的“依赖能力在宿主死亡瞬间仍 Active”判定与 808.1.d.3 的换区前
 *    最后已知信息没有卡牌可用路径。
 * “Play two 1 [M] Recruit unit tokens to your base” 半段已合入（effect.token 的
 * mode "play"），golden 用真实解释器 + 参考内核执行。
 */
export default {
  canonicalCardId: "card.hash-f94f709693f78579dcd97c1ebdba7859c74403424ef6cd195238e47541869fbf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，" +
    "827.1.c.1 的“1 Energy + 1 Order Power：Empower me，仅当未 Empowered 时启动”与 828.1.b.1 的" +
    "依赖能力（仅当 Empowered 时获得后面的 Deathknell 效果）都无展开实现；(2) 没有 Empowered 状态" +
    "谓词——442.1.a 的二元状态不在 ObjectSnapshot / Condition 里，触发过滤中的 `empowered: true`" +
    "只是描述性记录（严格触发器校验以 unknown-field 拒绝，golden 已断言）；(3) Deathknell 展开依赖 " +
    "trigger.leave 原语，effects/instructions/ 下没有该文件（与 kogmaw-caustic 同型缺口）；" +
    "(4) 727.1.c.1 的“依赖能力在宿主死亡时仍 Active”判定与 808.1.d.3 的换区前最后已知信息没有卡牌" +
    "可用路径。依赖新的 Empower/Empowered 关键词任务、RIFT-82（Deathknell / trigger.leave）与 " +
    "RIFT-87（条件/谓词）。“Play two 1 :rb_might: Recruit unit tokens to your base” 半段用已合入的 " +
    "effect.token（mode play）真实执行。",
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
