import type { CardProgram } from "../../ir/index.js";

/**
 * Dark Child, Starter (ogs-017-024) — Legend, Fury/Chaos, 标签 Annie/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogs-017-024）：
 *   At the end of your turn, ready 2 runes.
 *
 * 规则依据（CR v1.5）：
 * - 383.1："At the end of your turn …" 是触发能力（"at" + 回合流程时点）；
 *   317.1.a "At the end of this turn and at the end of turn Game Effects take
 *   place" 对应封闭时点 turn-end。190.6.d："your" 默认指能力控制者；191.1：
 *   每名玩家控制自己的 Champion Legend。
 * - 174 / 174.7：Legend 是 Game Object，可以有 Triggered Ability，且按
 *   107.4.c / 174.2.b 始终留在 Legend Zone（144 / 148）。
 * - 416.1 / 416.3.b：重置由 effect.ready 覆盖；416.1.b/416.1.c：已经就绪的对象
 *   再被 "ready" 指令时 nothing additional happens（不产生第二次重置事件）。
 * - 107.1.c / 417.1.b：Rune 与控制者一起位于其 Base（契约 ZoneId 记为
 *   "rune-zone"），"ready 2 runes" 指该玩家自己的符文（190.6.d 的隐含 "you"）。
 * - 文本没有 "up to"、也没有 "any number"，355.13 的"可选 0 个"许可不适用；
 *   玩家必须在结算时按 359.3.e.11（能部分执行就尽可能执行）选择并重置 2 个
 *   符文，不足 2 个时重置可用的那些。该选择不是目标（355.7），也不属于
 *   Finalize 步骤（355.5.b：永久物的触发能力在结算时才做选择），因此写成
 *   effect.ready 的结算期 choose 选择（非 targets / picks）。
 *
 * status = judge-required：见 judgeReason。"ready 2 runes" 本身只用已合入的
 * effect.ready（结算期 choose）就能执行，golden 用解释器 + 参考内核跑通；
 * turn-end 时点也已由回合流程 emit（turn/flow.ts 的 endTurn），卡牌程序的触发能力
 * 也已有注册接线；整张卡还不能执行：封闭 EventPattern 词表不接受 turn-end 拼写、
 * Legend 的来源区域也仍无当前效果契约表示。
 */
const darkChildStarter = {
  canonicalCardId:
    "card.hash-bada5b917cb4b9f966ee3a8e2d81ca8bcacdc8093220a3f2d94d8234495aae12",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不属于本卡 write scope：(1) 契约不一致：closed " +
    "EventPattern 词表只列 zone-entered/card-played/conquered 等事件名、没有任何阶段类时点名，" +
    "engine 的 validateTriggerSpec 会拒绝 event: \"turn-end\"（pipeline.registerTrigger 抛 " +
    "TriggerSpecValidationError）；运行时按 spec.at 命中时点（pipeline-match 比较 " +
    "event.kind ?? timingPoint），因此本卡沿用封闭时点拼写并保留该不一致。" +
    "turn-end 时点本身已由回合流程 emit（turn/flow.ts 的 endTurn，CR 317.1.a），" +
    "但 validateTriggerSpec 仍拒绝这个事件名。" +
    "(2) Legend 的来源区域是 Legend Zone（107.4.c），当前契约 ZoneId（effects/contract.ts）与参考内核都没有该区域，" +
    "默认 activeZones ['board'] 也覆盖不到 Legend 来源（174.7）。" +
    "「ready 2 runes」的效果本体只用已合入的 effect.ready（结算期 choose + 359.3.e.11 不足则尽可能），" +
    "golden 已用解释器 + 参考内核执行；按 README 第 2 节，整卡保持 judge-required。" +
    "依赖：EventPattern 时点词表与 Legend 区域契约。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "turn-end",
        // "your turn"：事件回合玩家就是本能力控制者（190.6.d / 191.1）。
        filter: { event: "turn-end", player: "self" }
      },
      optional: false,
      body: [
        {
          id: "dark-child.ready-2-runes",
          op: "effect.ready",
          args: {
            // 结算期选择（355.5.b / 355.10.f）：不是 TargetSpec；min=max=2 表示
            // "ready 2 runes"，可用对象不足时 effect.ready 按 359.3.e.11 收窄。
            objects: {
              kind: "constant",
              value: {
                kind: "choose",
                id: "dark-child.runes",
                // controller 的 "self" 是 events/trigger-spec.ts PlayerSelector 的
                // 契约拼写，chain/engine.ts 的 query 会把它绑定为能力控制者（190.6.d）。
                filter: { zone: "rune-zone", type: "rune", controller: "self" },
                min: 2,
                max: 2,
                prompt: "Ready 2 runes."
              }
            }
          }
        }
      ]
    }
  ],
  sourceText: "At the end of your turn, ready 2 runes."
} satisfies CardProgram;

export default darkChildStarter;
