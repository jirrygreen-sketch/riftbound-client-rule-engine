import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lillia, Fae Fawn (unl-082-219) — Unit, 3 energy, 无印刷力量，Might 3，Mind，
 * 标签 Fae/Lillia/Ionia/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-082-219，逐字）：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to
 *   have me enter ready.)
 *   When I move from a location, play a 3 :rb_might: Sprite unit token with
 *   [Temporary] there. (Kill it at the start of its controller's Beginning
 *   Phase, before scoring.)
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805.1 / 805.1.b）：可选附加费用关键词，卡内只声明 keyword（契约
 *   3.1/3.7、README 第 5 节），展开归 effects/keywords/Accelerate.ts。
 * - “When I move from a location”：383.1 的触发条件；一次成功的 Move（421.1 / 449.1 /
 *   449.2）在两个 Location 之间发生，458/458.1 的 Recall 不是 Move 也不会触发 Move 能力，
 *   因此封闭时点 object-moved 本身已经蕴含“从某个 location 移动”，不再加多余的起点谓词。
 * - “there”＝她移动前所在的那个 location：CR 359.3.f.3 正是以本卡为例，说明触发条件里引用的
 *   信息在该触发条件成立时（即触发时）记录，之后她再离开棋盘也不影响 token 的落点。
 * - “play a 3 [M] Sprite unit token with [Temporary]”：187.2 的 Sprite 是 3 Might、无领域、
 *   Fae 标签、带 [Temporary] 的单位 token；440.2.c / 185.2.a / 350.2 / 354 规定被“打出”的
 *   token 先在链上生成，再由 play 动作接手。
 *
 * status = judge-required（2026-10-17 按当前合入源码复核，四处缺口均实测，不近似实现）：
 * 1. 本卡的 Move 触发无法注册：abilities/triggers.ts 的 registerProgramTriggers 会以
 *    assertTriggerSpec 校验 trigger.at/filter，而 EVENT_PATTERN_TYPES 不含 "object-moved"，
 *    实测抛 TriggerSpecValidationError（trigger.filter.event invalid-event-type）——封闭事件
 *    词表用的是 "object-enters-board"/"object-leaves-battlefield" 一类时点。
 * 2. Sprite token 定义（187.2：3 Might、无领域、Fae 标签、带 [Temporary]）不在 effect.token
 *    的冻结定义表（recruit / sand-soldier / mech / reflection / tentacle）内：实测该指令
 *    返回 negated/impossible，一个 token 都造不出来。
 * 3. "there" 要绑定触发条件成立时记录的来源起点 location（359.3.f.3），而冻结的
 *    ObjectSelector 只有 self / source / target / pick / linked，没有触发事件载荷形态；
 *    程序以描述性常量保留该字段，属契约变更请求。
 * 4. [Accelerate]（805）的展开含 static `accelerate.cost`，programs/statics.ts 的 layerFor
 *    没有该 kind 的图层映射，实测绑定抛 ProgramBindingError，Finalize 也尚未把 CardProgram
 *    关键词展开接入 optionalAdditional 选择与收费。
 * 已合入并实测：[Accelerate] 的附加费用形状与入场就绪替代原语（effect.ready）、
 * [Temporary]（816）的 KeywordDef 与 effect.kill 展开（但它的 beginning-start 触发同样不在
 * 上述封闭事件词表内，见第 1 点）。
 * 依赖：object-moved/beginning-start 的封闭事件词表接线（或等价时点）、Sprite token 定义、
 * "there" 的触发载荷选择器（契约变更请求），以及 accelerate.cost 的图层/Finalize 接线。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "lillia-fae-fawn.play-sprite",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "sprite" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：被“打出”的 token 先在链上生成，再由 play 接手。
          mode: { kind: "constant", value: "play" },
          // “there”＝触发时记录的她移动前所在的 location（359.3.f.3）：触发事件载荷绑定尚未合入，
          // 这里保留描述性常量，不硬编码某个战场/基地。
          location: {
            kind: "constant",
            value: { triggerPayload: "object-moved", field: "fromLocationId" }
          },
          linkKey: { kind: "constant", value: "spriteToken" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-e7fb971d15005249a31882c5cfd8d34fe0a7c9bc54b39b4b466e719f4798f333",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处当前缺口（2026-10-17 实测，均不近似实现）：" +
    "(1) 本卡的 Move 触发无法注册：programs/triggers.ts 经 events/trigger-spec.ts 的 assertTriggerSpec 校验 trigger.at/filter，" +
    "而封闭 EVENT_PATTERN_TYPES 不含 \"object-moved\"，实测 registerProgramTriggers 抛 TriggerSpecValidationError" +
    "（trigger.filter.event invalid-event-type；词表用的是 object-enters-board / object-leaves-battlefield 一类时点）。" +
    "(2) Sprite token 定义（187.2：3 Might、无领域、Fae 标签、带 [Temporary]）不在 effect.token 的冻结定义表" +
    "（recruit/sand-soldier/mech/reflection/tentacle），实测该指令对 \"sprite\" 返回 negated/impossible，一个 token 都造不出来。" +
    "(3)「there」＝触发条件成立时记录的移动前 location（359.3.f.3 以本卡为原文例子）：冻结的 ObjectSelector 只有 self/source/target/pick/linked，" +
    "没有触发事件载荷形态，程序以描述性常量保留该字段并提交契约变更请求。" +
    "(4) [Accelerate]（805）的展开体的 static `accelerate.cost` 在 programs/statics.ts 的 layerFor 里没有图层映射，" +
    "实测 bindStatic 抛 ProgramBindingError；Finalize 也尚未把 CardProgram 关键词展开接入 optionalAdditional 选择与收费。" +
    "已合入的是 [Accelerate] 的附加费用形状与 effect.ready 入场就绪替代、[Temporary]（816）的 KeywordDef 与 effect.kill 展开" +
    "（其 beginning-start 触发同样不在上述封闭事件词表内）。" +
    "依赖：object-moved/beginning-start 的事件词表接线、Sprite 定义、there 选择器（契约变更请求）与 accelerate.cost 的图层/Finalize 接线。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
    "When I move from a location, play a 3 :rb_might: Sprite unit token with [Temporary] there. " +
    "(Kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default program;
