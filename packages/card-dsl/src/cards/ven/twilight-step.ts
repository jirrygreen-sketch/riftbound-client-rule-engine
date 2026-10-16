import type { CardProgram } from "../../ir/index.js";

/**
 * Twilight Step（ven-105-166）— Spell，2 Energy + 1 Chaos Power，领域 Chaos。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-105-166，逐字）：
 *   "Move a unit with 3 :rb_might: or less.\n"
 *   "[Flow] :rb_energy_4::rb_rune_chaos: (You may play this from your trash for its Flow cost. Then banish it.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - "Move a unit"：448.1 把永久物在 Board 上换位置定义为 Move；355.4 / 355.4.a 规定由效果移动单位时，
 *   目的地是 Move 前在 Finalize 选定的合法 Location（对被移动单位而言它"被允许存在"且不是当前位置）。
 *   已合入的 effect.move 的 to 支持具体 LocationRef、"controller-base" 或 { kind: "choose", id, options }。
 * - "a unit with 3 :rb_might: or less"：被点名的单位在公开区域且由玩家选择 → Target（355.7 / 355.9.a.1）；
 *   "Might 3 或以下"是 targeting restriction（355.9.b 的原文例子正是 "unit with Might 4 or greater"），
 *   读的是 143.2.a 的有效 Might。
 * - [Flow]（829.1 / 829.1.b / 829.1.c.1）：被动关键词，可从废牌堆以其 Flow 费用打出再放逐；印刷 Flow
 *   费用为 :rb_energy_4::rb_rune_chaos:（4 Energy + 1 Chaos Power）。按 README 第 5 节只声明关键词身份。
 *
 * status = judge-required（三处缺口，均不近似实现）：
 * 1. "with 3 :rb_might: or less" 的 Might 上限不可执行：冻结的 ObjectFilter 没有 Might 谓词，已合入的
 *    过滤器（layers/filter.ts 的 matchesObjectFilter、参考内核的 matchesFilter）只按
 *    type/types/zone/location/controller/owner/states/tags/characteristics 匹配，未知键（如程序里的
 *    mightLte）会被静默忽略——把它当成已实现会让任意单位都合法（同 sfd-158-221 Sandshifter、ogn-169-298 Gust
 *    的记录）。143.2.a 的有效 Might 读数与阈值谓词属 RIFT-83/RIFT-91 的 Mighty 类关键词批次。
 * 2. 移动目的地没有生产者：355.4 要求在选择目标时同时选定合法目的地（355.4.a：不是当前位置、且该单位
 *    被允许存在），但契约 3.6 与已合入原语里都没有"合法目的地集合"的读数（target.location）；
 *    effect.move 的 choose 形态要求 options 是一串具体 LocationRef，静态 IR 写不出来（同 rad-005-167
 *    Parallel Convergence 一类"移动到某地"的缺口，依赖 RIFT-9 target.location / RIFT-90 目标计划）。
 * 3. [Flow] 的展开依赖未合入：flow.cost 需要 RIFT-261 的替代费用消费方、替代放逐需要 RIFT-260 的
 *    replacement 路径；印刷 Flow 费用按契约 3.8.3 应经 params.cost 承载，而 KeywordAbility 无该字段
 *    （见最终回复的契约变更请求）。
 * 依赖：RIFT-83/RIFT-91（Might 谓词）、RIFT-9/RIFT-90（合法目的地集合与目标计划）、RIFT-260/261（Flow）。
 * golden 覆盖校验、身份与结构；三类依赖都以 test.todo 注明缺什么，不做整卡执行。
 */
const twilightStep = {
  canonicalCardId: "card.hash-f8d896c2ca5339609e26be4f09c5f2b54a57e4cae02b10efbb3319f94414f084",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1)「a unit with 3 :rb_might: or less」的 Might 上限不可执行——冻结的 ObjectFilter 没有 Might 谓词，" +
    "已合入过滤器只按 type/types/zone/location/controller/owner/states/tags/characteristics 匹配，描述性 mightLte 会被静默忽略" +
    "（当成已实现会让任意单位合法），143.2.a 的有效 Might 阈值属 RIFT-83/RIFT-91（同 sfd-158-221 Sandshifter、ogn-169-298 Gust）；" +
    "(2) 移动目的地没有生产者——355.4/355.4.a 要求在选定目标时同时选定该单位被允许存在的合法目的地，但契约 3.6 与已合入原语都没有" +
    "「合法目的地集合」读数（target.location），effect.move 的 choose 形态要求 options 是具体 LocationRef 列表，静态 IR 写不出来" +
    "（依赖 RIFT-9 与 RIFT-90）；" +
    "(3) [Flow]（829.1/829.1.c.1）的展开依赖未合入：flow.cost 需要 RIFT-261 的替代费用消费方、替代放逐需要 RIFT-260 的 replacement 路径，" +
    "且印刷 Flow 费用（4 Energy + 1 Chaos Power）按契约 3.8.3 应经 params.cost 承载而 KeywordAbility 无该字段（契约变更请求）。" +
    "依赖：RIFT-83/RIFT-91、RIFT-9/RIFT-90、RIFT-260/261。golden 只做校验/身份/结构断言。不近似实现。",
  abilities: [
    // 829.1.c.1：印刷 "[Flow] :rb_energy_4::rb_rune_chaos:"；费用归 Flow.ts 的展开（见 judgeReason 第 3 条）。
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        // 印刷费用 2 Energy + 1 Chaos Power（catalog energy=2, power=1, domains ["Chaos"]）。
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          id: "twilight-step.move-unit",
          op: "effect.move",
          args: {
            objects: { kind: "constant", value: { target: "twilight-step.unit" } },
            // 355.4 的合法目的地：不是当前位置、且该单位被允许存在。没有任何已合入读数产生这个集合
            // （见 judgeReason 第 2 条），故以描述性 query 记录意图，不硬编码某个战场或 Base。
            to: {
              kind: "constant",
              value: { kind: "query", id: "twilight-step.valid-destinations" }
            },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "moved" }
          },
          targets: [
            {
              id: "twilight-step.unit",
              // "a unit with 3 :rb_might: or less"：Board 上的单位（355.9.a.1），Might 上限是
              // 目标限制（355.9.b），但该键无消费方（见 judgeReason 第 1 条）。
              filter: { type: "unit", zone: "board", mightLte: 3 },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Move a unit with 3 :rb_might: or less.\n" +
    "[Flow] :rb_energy_4::rb_rune_chaos: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default twilightStep;
