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
 *   trigger.condition 的 Empowered 门槛。
 * - 187.1：Recruit 是 1 Might 的单位 token；契约 3.6 的 create-token 只允许单位
 *   进入控制者自己的 Base，对应原文 “to your base”。
 *
 * 当前执行边界见 judgeReason 与对应 golden；保留所有印刷语义。2026-10-18 复核后，
 * Deathknell 的门控与 token 本体仍由测试台真实执行，但生产 lifecycle 的注销时点
 * 与原生 token 打出绑定仍是硬缺口。测试台级执行证据见
 * test/cards/templates/keyword-triggered-object-killed-conditio-679.test.mjs
 * （2026-10-17 复核）：真实的 effect.empower 动作把死亡前状态翻成 Empowered 后，
 * 测试台用其声明的 trigger 操作入链并锁定了正文与 source.empowered=LKI。
 */
export default {
  canonicalCardId: "card.hash-f94f709693f78579dcd97c1ebdba7859c74403424ef6cd195238e47541869fbf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（2026-10-18 复核实测）：(1) Empower 印刷费用绑定：Empower.ts 已有 KeywordDef，" +
    "KeywordAbility / programs/keywords.ts 仍未传 params.cost，展开仍是占位 cost，translateCost 以 " +
    "\"Unsupported cost kind empower\" 拒绝，不能支付 1 Energy + 1 Order Power（827.1.c.1）。" +
    "(2) 生产 CardProgram lifecycle 会在 object-leaves-board 后立刻注销程序触发，实测真实 kill 提交后 " +
    "该注册数由 1 变 0、object-killed 扫描没有订阅，Deathknell 无法入链（808.1.c / 429.1.a.1.b）。" +
    "(3) effect.token(mode:play) 生成 cardId:null 的 Recruit，programs/play.ts / ProgramRegistry 仍要求有可执行程序，" +
    "生产链缺少此类原生 token 的打出绑定；不能用测试 describePlay 回调替代。" +
    "已真实执行且不再记作缺口的半段：参考内核与 createEngineStaticBinder 能按 442/443 增减 Empowered 并让 " +
    "compare 条件在触发扫描时判断 727.1.c.1 / 808.1.d.3 的依赖门槛（golden 覆盖死亡前门控入链），" +
    "to your base 经 Expr.location 绑定实际控制者后产出两枚 Recruit。不近似实现费用或 token 打出。",
  abilities: [
    {
      // 印刷费 1 Energy + 1 Order Power 见 judgeReason；KeywordAbility 没有 params
      // 字段（契约 3.8.3 的 params 只加在 KeywordDef.expand 的输入上），不伪造第二条
      // 启动能力，与 ven-149-166 Defender of Tomorrow 的写法一致。
      kind: "keyword",
      keyword: "empower"
    },
    {
      // [Empowered][>>][Deathknell][>] 的依赖能力：在触发扫描时以来源的死亡前状态判断
      // 442.1.a 的 Empowered 门槛（727.1.b.3 / 808.1.d.3）。
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: { self: true, cause: "kill", destination: "trash" },
        condition: {
          kind: "compare",
          left: { kind: "object-property", object: "source", property: "empowered" },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "noxian-emissary.base-location",
          op: "condition.value",
          args: {
            // token 原语消费 Expr 链接值；地点求值由解释器的既有位置选择器完成。
            value: { kind: "location", value: "ability-controller-base" }
          }
        },
        {
          id: "noxian-emissary.play-two-recruits",
          linkedTo: "noxian-emissary.base-location",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 2 },
            // 440.2.c / 185.2.a：被“打出”的 token 先在链上生成再交给打出流程。
            mode: { kind: "constant", value: "play" },
            // “to your base”：消费按实际能力控制者解析的地点，而非字面玩家名。
            location: {
              kind: "linked-value",
              instructionId: "noxian-emissary.base-location",
              key: "value"
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
