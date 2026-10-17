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
 * status = judge-required（缺口均不近似实现）：
 * - Sprite token 定义（187.2）不在 effect.token 的冻结定义表（recruit / sand-soldier / mech /
 *   reflection / tentacle）内；带自身关键词的 token 定义按原语文档保持 blocked，仍需扩展
 *   token 定义表。
 * - “there” 需要绑定「触发条件记录的来源起点 location」，冻结的 ObjectSelector（self / source /
 *   target / pick / linked）没有“触发事件载荷”形态，程序里以描述性常量保留该字段；属于契约变更请求。
 * - object-moved 事件的 payloadFields（fromKind / fromLocationId / toKind / toLocationId）当前没有被
 *   events/action-adapter.ts 填值，且卡牌程序的 trigger filter 锚点（source: "self"）没有消费方
 *   （events/pipeline-match.ts 只读 EventPattern 顶层 object/source/target/player/fromZone/toZone/
 *   amount/details），因此 Move 自发触发与“是我在移动”的判定都没有接线。
 * - [Temporary]（816）的 KeywordDef、`effect.kill` 展开和 CardProgram 触发注册已经合入；
 *   token 的真实清理仍被 Sprite 定义与“there”事件载荷阻塞。
 * - [Accelerate] 的 KeywordDef、附加费用形状和入场就绪替代已经合入，但
 *   `programs/play.ts` 尚未把卡牌关键词展开接入 Finalize 的 optionalAdditional 选择与收费。
 * 依赖：移动事件载荷与触发绑定、Sprite token 定义、“there”的触发载荷选择器，以及
 * Accelerate 的 CardProgram → Finalize 接线。
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
    "四处缺口，均不近似实现：(1) Sprite token 定义（187.2：3 Might、无领域、Fae 标签、带 [Temporary]）不在 effect.token 的冻结定义表" +
    "（recruit/sand-soldier/mech/reflection/tentacle），带自身关键词的定义按原语文档保持 blocked，仍需扩展 token 定义表。" +
    "(2)「there」＝触发条件成立时记录的移动前 location（359.3.f.3 以本卡为原文例子）：冻结的 ObjectSelector 只有 self/source/target/pick/linked，" +
    "没有触发事件载荷形态，程序以描述性常量保留该字段并提交契约变更请求。" +
    "(3) object-moved 触发仍缺事件载荷：events/action-adapter.ts 未为 move-location 填 fromKind/fromLocationId/toKind/toLocationId，" +
    "因此“there”与来源 self 不能在真实 Move 中绑定。" +
    "(4) [Temporary]（816）的 KeywordDef、effect.kill 展开和 CardProgram 触发注册已经合入，" +
    "但 token 仍需先由 Sprite/there 链路真实生成，才能参与 Beginning Phase 的清理。" +
    "[Accelerate]（805）的 KeywordDef、附加费用形状和入场就绪替代已经合入；" +
    "programs/play.ts 仍未把该展开接入 Finalize 的 optionalAdditional 选择与收费。依赖：移动事件载荷、Sprite 定义、" +
    "there 选择器与 Accelerate 的 CardProgram → Finalize 接线。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
    "When I move from a location, play a 3 :rb_might: Sprite unit token with [Temporary] there. " +
    "(Kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default program;
