import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Nasus, Guardian of Knowledge (ven-063-166) — Unit, Mind, Dog/Shurima/Nasus/Champion.
 *
 * 原文："Once each turn, when an enemy unit here dies, channel 1 rune exhausted."
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.2.a：Condition 是含 When/At/the Nth Time 的从句；383.3.e / 383.3.e.1
 *   规定 "once each turn" 的触发式能力每回合只执行指定次数，若条件本回合已满足过
 *   则不触发。契约 3.5 的 TriggerSpec 用 once: "per-turn" 表达该寿命
 *   （events/pipeline.ts 的 frequencyKey 按 turn 计数）。
 * - 383.4 / 808.1.d：本体是"某个单位死亡"的事件触发；时点 "object-killed"
 *   （events/timing-points.ts，ruleRefs 429.1/429.2/808.1.d），由 kill 动作在
 *   实际换区前发出，替代掉死亡则不触发（429.x / 808.1.d）。
 * - "an enemy unit here"："
 *   - enemy → 对手控制的单位：controller: "opponent"（170.x 的对手定义；
 *     layers/filter.ts 的 selectorMatches 将 opponent 与控制器比较）。
 *   - here → 与本体同一位置：契约 3.6 在 ObjectFilter 上提供 sameLocationAs
 *     锚点，取符号选择器 "self"（同一个对象的当前 location），解释器按
 *     location 键比较（base: 玩家 / battlefield: id）。
 *   - unit → type: "unit"（死亡的对象是单位；428/429 的区别由时点与内核保证）。
 * - "channel 1 rune exhausted"：431.1 定义 Channel（把 Rune Deck 顶的符文放到
 *   Board 上的 Rune 区）；431.2/431.2.a 允许效果规定符文进入时的状态，本卡规定
 *   exhausted。用已合入的 effect.channel（amount 1、exhausted true）；431.4.b
 *   明确此类"由游戏效果指示的 Channel"正是本原语覆盖的范围（Channel Phase 的
 *   常规 Channel 属回合流程，不在卡牌程序里）。
 *
 * 结构说明：引用的都是契约 3.6 的符号选择器与封闭时点，不写运行时 ObjectRef、
 * 不自己推进回合、不手改符文状态。
 *
 * 复核：triggerRegistrations 已把 CardProgram 的 triggered 能力接入 EventPipeline，
 * per-turn frequencyKey 也会消费 TriggerSpec.once；仍缺的是 sameLocationAs（“here”）：
 * 它在翻译层被判为 unsupported filter field（fail closed），运行时事件匹配器也不识别
 * 该锚点。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: {
        event: "object-killed",
        filter: {
          type: "unit",
          controller: "opponent",
          zone: "board",
          sameLocationAs: "self"
        }
      },
      once: "per-turn"
    },
    optional: false,
    body: [
      {
        id: "nasus-guardian-of-knowledge.channel",
        op: "effect.channel",
        args: {
          amount: { kind: "constant", value: 1 },
          exhausted: { kind: "constant", value: true }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-356162b4f965ef0d8365391eaacb8f6ce7a5990f15529e553d4fd98f3e20bb89",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发条件里的“here”无法可靠判定：契约 3.6 的 ObjectFilter 有 sameLocationAs 锚点，" +
    "但 triggerRegistrations → translateTriggerFilter → translateObjectFilter 只接受白名单字段，" +
    "sameLocationAs 会被判为 unsupported filter field " +
    "而拒绝注册（fail closed，不会退化成“任意位置”），同时时点事件 filter 的运行时匹配走 " +
    "events/pipeline-match.ts 的 matchesTriggerEvent / matchesTriggerObject，它只识别 " +
    "objectId/cardId/type/controller/owner/" +
    "zone/states/tags/characteristics，不识别 sameLocationAs，也没有把“事件对象的 location 与来源 " +
    "location 比较”的路径；" +
    "同时 808.1.d.3 要求先记录来源位置再处理触发，死亡事件虽携带 last-known 快照，却没有把该位置交给" +
    "卡牌条件的通道。“Once each turn”的 per-turn 寿命（383.3.e.1、契约 TriggerSpec.once，" +
    "frequencyKey 已消费）与 effect.channel 1 rune exhausted（431.1/431.2.a，已合入）本身可用；" +
    "不近似实现：不用“任意敌方单位死亡”替代“这里”，也不放宽 once-per-turn。" +
    "依赖：事件匹配器的 sameLocationAs/位置锚点扩展（契约变更请求）。",
  abilities,
  sourceText: "Once each turn, when an enemy unit here dies, channel 1 rune exhausted."
} satisfies CardProgram;
