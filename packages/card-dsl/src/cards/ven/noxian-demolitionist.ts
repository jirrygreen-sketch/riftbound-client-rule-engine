import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Noxian Demolitionist (ven-080-166) — Unit, 2 Energy, Might 1, Body, tag Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-080-166，逐字）：
 *   When I conquer, you may kill a gear with Energy cost no more than my Might.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.c / 383.4.c.1：以 "When I conquer" 起首的触发式能力是 Conquer Effect，引用做出
 *   Conquer 的单位；468.5.d / 471.1 / 473.2.a 定义 Conquer 的成立条件。封闭时点 "conquer"
 *   （events/timing-points.ts，ruleRefs 468.5.d/471.1/473.2.a）承载该条件；383.4.c.2.c 说明
 *   即使得分被否定或替代该触发仍然发生，因此触发不写得分成败条件。
 * - 403.1 / 契约 3.9：效果首段的 "you may" 是触发能力自身的可选执行（optional = true），
 *   被选指令包进 choice.optional 的 body，不写 choice + linkedTo。
 * - 355.7 / 355.9.a.1："kill a gear" 指名的对象是目标（"gear" 未另有说明时指 Board 上的
 *   装备）；结算时目标失效按 359.3.e.7 处理。
 * - 429.1 / 429.1.a.1 / 429.6：消灭是永久物从场上进入弃牌堆的动作；效果指示的 Active
 *   Kill（Kill Instruction）由已合入的 effect.kill 提交 kill 动作。
 * - 143.2.a："my Might" 读的是本单位当前的 Might；"Energy cost" 读目标的印刷 Energy 值
 *   （ObjectSnapshot.energy；null 表示没有印刷值，绝不换算成 0）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，缺口与依赖见 judgeReason。
 * golden 用真实解释器 + 参考内核执行 effect.kill 的接受、拒绝与选项放弃三条路径
 * （都只使用已合入原语）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquer", filter: { source: "self" } }
    },
    optional: true,
    body: [
      {
        id: "noxian-demolitionist.may-kill-gear",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Kill a gear with Energy cost no more than my Might?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "noxian-demolitionist.kill-gear",
                op: "effect.kill",
                args: {
                  target: { kind: "constant", value: "noxian-demolitionist.gear" }
                },
                targets: [
                  {
                    id: "noxian-demolitionist.gear",
                    // "a gear"：Board 上的任意装备（355.9.a.1），原文没有控制者限制。
                    filter: { type: "gear", zone: "board" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ],
                // "with Energy cost no more than my Might"：355.9.b 的目标限制需要一个
                // 动态比较（目标的印刷 Energy 值 vs 宿主当前 Might，143.2.a）。冻结的
                // ObjectFilter / 已合入匹配器没有该类锚点或谓词（未知键被静默忽略），
                // 因此按 359.3.e 的重验语义写成结算期 condition（见 judgeReason）。
                condition: {
                  kind: "compare",
                  left: {
                    kind: "object-property",
                    object: { target: "noxian-demolitionist.gear" },
                    property: "energy"
                  },
                  operator: "lte",
                  right: {
                    kind: "object-property",
                    object: "self",
                    property: "might"
                  }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-ab6b3fd38bb2a4975bf416bdfc074f82b2ad97c5aa662fe337dcb43a9074612d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) conquer 触发进不了链——conquer 时点虽在 events/timing-points.ts 的封闭枚举中" +
    "（468.5.d/471.1/473.2.a），但 scoring/（RIFT-76）未接入 chain/events 单管线（RIFT-120），" +
    "没有生产者 emit conquer，也没有已合入订阅方把 CardProgram 的 triggered ability 注册成 " +
    "TriggerRegistration（契约 §7.2 批 5）；(2) “with Energy cost no more than my Might”是 Finalize " +
    "目标合法性里的动态比较（355.9.b；左侧是目标的印刷 Energy 值、右侧是能力宿主当前 Might，" +
    "143.2.a），冻结 ObjectFilter 与已合入匹配器没有该类锚点/谓词（未知键被静默忽略），程序按 " +
    "359.3.e 的目标重验语义把它写成 effect.kill 指令上的结算期 condition，Finalize 侧的限制求值仍" +
    "依赖 RIFT-90 的目标管线；目标没有印刷 Energy 值（energy: null）时比较不可求值，不换算为 0。" +
    "已支持部分：effect.kill 本体已合入，golden 用真实解释器 + 参考内核执行接受、拒绝（Energy 值" +
    "高于 Might 时整条未执行）与选项放弃三条路径。不近似实现。",
  abilities,
  sourceText: "When I conquer, you may kill a gear with Energy cost no more than my Might."
} satisfies CardProgram;
