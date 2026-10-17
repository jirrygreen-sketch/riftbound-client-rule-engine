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
 * status: judge-required —— 三处依赖未合入：
 * 1. [Deathknell] 的关键词展开不可执行：keywords/Deathknell.ts 的展开体引用未合入的
 *    trigger.leave 原语（该文件自身注明；effects/instructions/ 没有该 op 的注册文件），
 *    触发收集到入链的关键词接线尚未完成（RIFT-82）；
 * 2. 触发注册：没有生产方读取 CardProgram 的 triggered 能力并注册到事件管线
 *    （RIFT-257）；本卡声明的 object-killed 自引用过滤也需随该批归一化。
 * 3. "into your base" 的目标地点需要把 "controller" 占位解析成当前控制者的 Base：
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
    "[Deathknell] 的关键词展开不可执行：keywords/Deathknell.ts 的展开体引用未合入的 trigger.leave 原语" +
    "（808.1.d 的触发收集到入链接线，依赖 RIFT-82）；" +
    "触发的能力注册也缺生产方（RIFT-257，没有读取 CardProgram triggered 能力并注册到事件管线的路径）；" +
    "「Play three 1 [M] Recruit unit tokens into your base」的目标地点需要把 base 的 " +
    "player controller 占位解析成当前控制者（440.4），合并的 effect.token 只接受具体 LocationRef，" +
    "占位会 negated/impossible。效果本体（187.1 Recruit x3）可用已合入的 effect.token mode play 执行，" +
    "故仅上述三点保持 judge-required。依赖：RIFT-82、RIFT-257、effect.token 的 controller-base 占位解析。",
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
