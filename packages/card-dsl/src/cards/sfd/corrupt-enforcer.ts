import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Corrupt Enforcer (sfd-123-221) — Unit, Chaos, tag Piltover.
 * energy 3, power 1 (Chaos), Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-123-221，逐字，含换行）:
 *   "When I move to a battlefield, discard 1.\n"
 *   "When I win a combat, draw 1."
 *
 * 规则依据（CR v1.5）：
 * - "When I move to a battlefield"（421.1、449.1/449.2）：Move 是永久物在两个 Location
 *   之间的移动；458/458.1 的 Recall 不是 Move。封闭时点 object-moved 表示一次成功的
 *   Move（events/timing-points.ts，refs 421.1/449.1/449.2/458），filter 用 EventPattern 的
 *   toZone: "battlefield" 表达「移动到战场」，内层锚点 source: "self" 指称本卡
 *   （已合入 sfd/corinna-veraza、ogn/noxian-drummer 采用同一写法）。
 * - "discard 1"（423.1）：Discard 是把牌从手牌直接放进其拥有者的 Trash；423.1.a 的
 *   秘密选择由执行弃牌的玩家做，弃牌者是能力控制者（190.6.d 的 "you"）。已合入的
 *   effect.discard 只提交封闭的 discard 动作，不自己选牌/改区域。
 * - "When I win a combat"：一次 Combat 的结果在战斗清理后由 combat-result 判定
 *   （468.3.a-d 定义玩家与单位的胜/负/No Result；468.4），胜方为能力控制者。
 * - "draw 1"（414.1/414.3）：effect.draw，抽牌者缺省为能力控制者。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。两处真实缺口：
 * - object-moved 触发无法注册：events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 不含
 *   object-moved，registerTrigger 抛 TriggerSpecValidationError；即便注册成功，
 *   events/action-adapter.ts 的 move-location 映射也不填 toZone/toKind（zone-enter/leave
 *   分支才有这些字段），因此 toZone: "battlefield" 无法命中（449.1/449.2 的起终点、
 *   458 的 Recall 排除据此无法执行）。内层 filter 的 source: "self" 已由
 *   programs/filters.ts 的 translateTriggerFilter 转成宿主 objectId，golden 验证该转换。
 * - combat-result 时点没有发射方：events/action-adapter.ts 只按已提交游戏动作派生时点，
 *   combat/ 的胜负判定（468.3）尚未接入事件管线，全仓库没有 combat-result 的 emit；
 *   // 「I win」的胜者绑定同样需要该发射路径。
 * 依赖：move-location 的触发注册与终点载荷、combat-result 发射（RIFT-33/RIFT-124）。
 * 两条正文指令（effect.discard / effect.draw）已合入并有 golden 执行证据；不近似实现触发判定
 * （不把任何移动都当作「移动到战场」，不把 combat-result 改成别的时点）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: {
        event: "object-moved",
        toZone: "battlefield",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "corrupt-enforcer.discard-1",
        op: "effect.discard",
        args: {
          amount: { kind: "constant", value: 1 },
          // 423.1.a 的秘密选择需要稳定重放 id；弃牌者缺省为能力控制者。
          choiceId: { kind: "constant", value: "corrupt-enforcer.discard" }
        }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: {
      at: "combat-result",
      // 468.3.a / 468.4：「I win a combat」= 该 Combat 的胜方是能力控制者。
      filter: { event: "combat-result", player: "self" }
    },
    optional: false,
    body: [
      {
        id: "corrupt-enforcer.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-6666f6b3e8f7bb7ccdcff09e4d51d69c2067503b913dd14022cb3d88f30b9476",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "object-moved 触发无法注册：events/trigger-spec.ts 的 EVENT_PATTERN_TYPES 不含 object-moved，" +
    "registerTrigger 抛 TriggerSpecValidationError；即便注册成功，events/action-adapter.ts 的 " +
    "move-location 映射也不填 toZone/toKind（zone-enter/leave 分支才有这些字段），因此 " +
    "toZone: \"battlefield\" 无法命中；" +
    "449.1/449.2 的起点终点、458 的 Recall 排除据此无法执行。" +
    "内层 source: \"self\" 已由 translateTriggerFilter 转成宿主 objectId。" +
    "第二条「When I win a combat」同样不可执行：combat-result 时点没有发射方（events/action-adapter.ts " +
    "只为已提交游戏动作派生时点，combat/ 的 468.3 胜负判定尚未接入事件管线，全仓库无 combat-result 的 emit），" +
    "「I win」的胜者绑定也需要该发射路径。" +
    "两条正文指令已合入：effect.discard（423.1/423.1.a 弃 1，弃牌者为控制者）与 effect.draw（414.1/414.3 抽 1），" +
    "golden 用参考内核真实执行，但触发判定不近似实现。" +
    "依赖：move-location 的触发注册与终点载荷、combat-result 发射与胜负绑定（RIFT-33/RIFT-124）。",
  abilities,
  sourceText:
    "When I move to a battlefield, discard 1.\n" +
    "When I win a combat, draw 1."
} satisfies CardProgram;

export default program;
