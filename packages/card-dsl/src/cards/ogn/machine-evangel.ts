import type { CardProgram } from "../../ir/index.js";

/**
 * Machine Evangel (ogn-239-298) - Unit, Order, Piltover (M2 unit shard 12).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-239-298):
 *   [Deathknell] - Play three 1 :rb_might: Recruit unit tokens into your base.
 *   (When I die, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - 808.1 / 808.1.c：Deathknell 功能上等同 "When I die, [Effect]."；808.1.d / 808.1.d.2 /
 *   808.1.d.3 / 429.1.a.1.b：本永久物被消灭时，触发在换区前作为 Pending Item 入链
 *   （时点 object-killed，见 events/timing-points.ts 的 object-killed，ruleRefs 429.1/808.1.d）。
 * - 187.1：1 [M] Recruit 是无域、1 Might、Recruit 标签的单位 token（本卡的 token 定义）。
 * - 185.2.a / 440.2.c：被"打出"的 token 先在链上生成，再由 Play 动作接手完成打出流程；
 *   effect.token 的 mode "play" 已支持该链上创建 + 打出（RIFT-62 合入后不再是阻断项）。
 * - 440.4：新创建对象的控制者是效果控制者，即 "your base" 里的 your = 本卡控制者。
 *
 * status: judge-required —— 两处真实缺口仍在：
 * 1. [Deathknell] 的关键词展开引用尚未实现的 trigger.leave 原语；其展开过滤器还带有
 *    当前 trigger adapter 不接受的 cause / destination 字段，因此展开程序不能绑定。
 * 2. "into your base" 的目标地点需要把 "controller" 占位解析成当前控制者的 Base：
 *    合并的 effect.token 只接受具体 LocationRef，遇到 player: "controller" 占位会
 *    negated/impossible（契约 3.6 与 effect.token 文档）。
 * 本卡的 [Deathknell] 效果本体（三个 Recruit token）用已合入的 effect.token 表达，并在 golden
 * 测试中以具体 Base 替换占位后真实执行；上述三点保持 pending，不把占位当可执行。
 */
const machineEvangel = {
  canonicalCardId: "card.hash-17636361767d3b9981692423637f956799fa03a84c22ee687c41f59f2b58aa59",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Deathknell] 的关键词展开仍引用未实现的 trigger.leave 原语，且生成的 object-killed 过滤器含有 " +
    "当前 trigger adapter 不接受的 cause / destination 字段；" +
    "本卡显式 object-killed 触发已有 CardProgram 注册路径，但会被该关键词展开失败阻断；" +
    "「Play three 1 [M] Recruit unit tokens into your base」的目标地点需要把 base 的 " +
    "player controller 占位解析成当前控制者（440.4），合并的 effect.token 只接受具体 LocationRef，" +
    "占位会 negated/impossible。效果本体（187.1 Recruit x3）可用已合入的 effect.token mode play 执行，" +
    "故仅上述缺口保持 judge-required。依赖：trigger.leave 与 Deathknell 过滤器适配，以及 effect.token 的 controller-base 占位解析。",
  sourceText:
    "[Deathknell] — Play three 1 :rb_might: Recruit unit tokens into your base. (When I die, get the effect.)",
  abilities: [
    { kind: "keyword", keyword: "deathknell" },
    {
      // [Deathknell] 的效果本体：808.1.c 的 "When I die, [Effect]" 显式写出（与 unsung-hero 同构）。
      kind: "triggered",
      trigger: { at: "object-killed", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "machine-evangel.play-recruits",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 3 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            },
            linkKey: { kind: "constant", value: "machineEvangelRecruits" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default machineEvangel;
