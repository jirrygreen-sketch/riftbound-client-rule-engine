import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Pyke, Returned (unl-145-219) — Unit, Chaos, tags Pyke/Bilgewater/Champion.
 * energy 3（power: null，无印刷力量费）, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-145-219，逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   [Backline] (I must be assigned combat damage last.)
 *   Once each turn, when an enemy unit dies while I'm at a battlefield, play a Gold
 *   gear token exhausted. (It has "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811）与 [Backline]（826）都是关键词，卡牌只声明（契约 3.1/3.7、README 第 5 节）；
 *   展开分别归 effects/keywords/Hidden.ts（static cost.hidden）与 effects/keywords/Backline.ts
 *   （static continuous.combat 的伤害分配顺序），本卡不重写。
 * - 死亡事件触发用封闭时点 object-killed（383.1/383.4；timing-points.ts 的 ruleRefs
 *   429.1/429.2/808.1.d），事件对象过滤为“对手控制的单位”（740.1.b 的 enemy 定义）。
 * - 383.2.a.1：“while I'm at a battlefield” 紧跟在触发条件之后，是触发条件的一部分，在进链前求值；
 *   用 count 加过滤器锚点读来源（self）的位置。
 * - 383.3.e / 383.3.e.1：“Once each turn” 的每回合一次寿命由
 *   TriggerSpec.once = "per-turn" 表达（契约 3.5；已合入的 nasus-guardian-of-knowledge 同型）。
 * - 187.5：Gold gear token 是无域、自带 “[Reaction][>] Kill this, [E]: [Add] [A]” 的 gear token；
 *   440.2.c / 185.2.a / 350.2 / 354 要求被“打出”的 token 先在链上创建、再交给打出流程；
 *   184.1 / 185.2.d 允许创建效果规定入场状态（此处 "exhausted"），它不是一次横置动作。
 *
 * status = judge-required（缺口不近似实现）：
 * - effect.token 的冻结 DEFINITIONS 表只有 recruit/sand-soldier/mech/reflection/tentacle，
 *   没有 gold（该文件明确“自带其他能力的定义，包括 Gold，保持 blocked/judge-required”，187.5）；
 *   create-token 也不支持入场状态改写（184.1/185.2.d，143.4 的默认横置入场例外）——
 *   先创建再补一次 effect.exhaust 会多出一次“成为横置”事件，故不近似。
 * - “while I'm at a battlefield” 的进链前条件求值没有合并路径：事件管线（events/pipeline.ts）对带
 *   condition 的注册要求 host.testTrigger 适配器（TestWorld 等测试宿主已有，但没有生产方把 
 *   CardProgram 的触发注册进管线），也没有把来源的 last-known 位置交给卡牌条件。
 * 依赖：RIFT-62 后续（Gold 定义、链上创建与入场状态改写）、触发注册生产方（RIFT-120 的
 *   CardProgram → TriggerRegistration 适配）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  { kind: "keyword", keyword: "backline" },
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: {
        event: "object-killed",
        // “an enemy unit dies”：事件对象是刚被消灭的单位，由本能力的对手控制（740.1.b）。
        object: { type: "unit", controller: "opponent" }
      },
      // 383.2.a.1：附加条件从句属于触发条件，在进链前判定。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: {
            // “while I'm at a battlefield”：来源自身位于战场；location: "battlefield"
            // 是 layers/filter.ts 与事件匹配器共用的位置拼写（053.3 的 here 语义）。
            object: "self",
            location: "battlefield"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      },
      // 383.3.e.1：“once each turn” 的每回合一次寿命。
      once: "per-turn"
    },
    optional: false,
    body: [
      {
        id: "pyke-returned.play-gold-token",
        op: "effect.token",
        args: {
          // 187.5 的 Gold gear token 定义缺席（见文件头与 judgeReason）。
          token: { kind: "constant", value: "gold" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：被“打出”的 token 先在链上创建，再交给打出流程。
          mode: { kind: "constant", value: "play" },
          // Gear token 的名义目的地：控制者 Base（359.2.d 的 Gear 常规位置）。
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          linkKey: { kind: "constant", value: "goldToken" }
          // “exhausted” 是入场状态规定（184.1/185.2.d），create-token 不支持该改写；
          // 不新增 IR 参数键，也不用事后 effect.exhaust 冒充（见 judgeReason）。
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-409271324918d19e0c793fcbe4bce41cb7805a7f78155c1a3a115ce79c2140c2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Gold gear token 的可执行路径：「play a Gold gear token exhausted」需要 187.5 的 Gold 定义" +
    "（effect.token 的冻结 DEFINITIONS 表只有 recruit/sand-soldier/mech/reflection/tentacle，" +
    "自带其他能力的定义按该文件说明保持 blocked）与 440.2.c/185.2.a/350.2/354 的链上创建 + 打出流程，" +
    "以及 184.1/185.2.d 的入场状态改写（143.4 是单位默认横置入场的例外来源）；" +
    "create-token 不支持入场状态规定，先创建再补一次 effect.exhaust 会产生错误的「成为横置」事件，故不近似。" +
    "另一处缺口是触发条件：「while I'm at a battlefield」（383.2.a.1 的附加条件属触发条件）没有进链前的求值路径——" +
    "事件管线（events/pipeline.ts）对带 condition 的注册要求 host.testTrigger 适配器，测试宿主有该适配器，" +
    "但没有生产方把 CardProgram 的触发注册进管线，也没有把来源的 last-known 位置交给卡牌条件" +
    "（RIFT-120 的 CardProgram → TriggerRegistration 适配）。" +
    "[Hidden]（811）与 [Backline]（826）只按契约 3.7 声明关键词；两者的 KeywordDef 已合入，" +
    "其展开消费方（静态 cost.hidden 的 Hide 动作、continuous.combat 的伤害分配顺序）没有运行时消费方" +
    "（RIFT-89/RIFT-91 后续与战斗工作流）。" +
    "依赖：RIFT-62 后续（Gold 定义、链上创建与入场状态改写）、触发注册生产方（RIFT-120）。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Backline] (I must be assigned combat damage last.)\n" +
    "Once each turn, when an enemy unit dies while I'm at a battlefield, play a Gold gear token exhausted. " +
    '(It has "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")'
} satisfies CardProgram;
