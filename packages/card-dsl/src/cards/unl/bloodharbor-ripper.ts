import type { CardProgram } from "../../ir/index.js";

/**
 * Bloodharbor Ripper (unl-185-219) — Legend, Fury/Chaos, tag Pyke.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-185-219，逐字）：
 *   :rb_energy_1:, :rb_exhaust:: Return a friendly unit at a battlefield to its
 *   owner's hand. Play a Gold gear token exhausted. (It has "[Reaction][>] Kill
 *   this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")
 *
 * 规则依据（CR v1.5）：
 * - 404.1.a / 415.5：“:” 之前是费用——1 Energy 加上横置来源；合并费用管线
 *   （cost/plan-values.ts、cost/payment.ts）支持 energy 与 { kind: "exhaust",
 *   object: "self" }。
 * - 174.8 / 376：Legends 可以有启动能力；本卡没有 [Reaction]，默认 Action 时机。
 * - “Return a friendly unit at a battlefield to its owner's hand”：单个由你控制的
 *   战场单位是选目标（355.9 / 355.10）；effect.zone 的 to "hand" 提交
 *   return-to-hand，并按 CR 108/128（非棋盘区域移动产生新对象身份、回手路由到拥有者）
 *   交给内核处理。
 * - “Play a Gold gear token exhausted” 是独立语句（与前半句无 “do X to Y” 依赖）：
 *   187.5 的 Gold gear token 是 0 Might、无域、带自身启动能力的 gear token；
 *   按 440.2.c / 185.2.a “play” 需要先创建到链上再交给打出流程，且 184.1 的
 *   “exhausted” 入场状态改写需要 create-token 支持。
 *
 * status = judge-required：
 * - effect.token 的冻结定义表没有 gold（其自身能力使其按设计保持 blocked），
 *   且 mode "play" 需要链上创建 + 费用免除的打出流程（440.2.c / 185.2.a /
 *   350.2 / 354），合并内核的 create-token 只支持直接创建到棋盘；
 * - “exhausted” 入场改写（143.4 / 184.1 / 185.2.d）在 create-token 中不支持，
 *   先创建再横置会产生错误的“成为横置”事件，不近似实现。
 * 前半段（回手）是已合入能力的真实执行部分。
 *
 * 依赖：RIFT-62 的 create-token to "chain" + cost.printed/cost.pay 打出接线、
 * Gold 定义（187.5）与入场状态改写。
 */
export default {
  canonicalCardId:
    "card.hash-44826d4fb44c1cba31372acf1fccde3b5f508addd708d0b4314a96a94579b8c3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "“Play a Gold gear token exhausted” 无可执行路径：effect.token 的冻结定义表没有 gold（187.5 的 Gold gear token 带自身能力，按原语文档保持 blocked），" +
    "mode \"play\" 需要先创建到链上再交给打出流程（440.2.c / 185.2.a / 350.2 / 354），合并内核的 create-token 只支持直接创建到棋盘；" +
    "“exhausted” 入场改写（143.4 / 184.1 / 185.2.d）不被 create-token 支持，先创建再补一次横置会产生错误的“成为横置”事件，不近似实现。" +
    "依赖：RIFT-62（create-token to chain 与 effect.play 交接）、Gold 定义与入场状态改写。" +
    "前半段 “Return a friendly unit at a battlefield to its owner's hand” 的 effect.zone 已合入，golden 用真实解释器 + 参考内核执行。",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: 1 },
        payments: [{ kind: "exhaust", object: "self" }]
      },
      body: [
        {
          id: "bloodharbor-ripper.return-unit",
          op: "effect.zone",
          args: {
            target: { kind: "constant", value: "friendly-unit-at-battlefield" },
            to: { kind: "constant", value: "hand" }
          },
          targets: [
            {
              id: "friendly-unit-at-battlefield",
              // 355.9 / 355.10：“a friendly unit at a battlefield” 是单个选目标。
              filter: {
                type: "unit",
                controller: "controller",
                location: { type: "battlefield" }
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 独立语句，不链接到回手（README 第 4 节：独立语句不强行 linkedTo）。
          id: "bloodharbor-ripper.play-gold",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } }
            // “exhausted” 入场改写：create-token 尚不支持（见 judgeReason）。
            // 不新增 IR 参数键，也不会先创建再补一次横置（那会产生错误的
            // “成为横置”事件，且错过 184.1 的入场状态改写）。
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_energy_1:, :rb_exhaust:: Return a friendly unit at a battlefield to its owner's hand. " +
    'Play a Gold gear token exhausted. (It has "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")'
} satisfies CardProgram;
