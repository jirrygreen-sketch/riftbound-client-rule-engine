import type { CardProgram } from "../../ir/index.js";

/**
 * Cloud Drake (ven-048-166) — Unit, Mind, Dragon/Demacia.
 *
 * 原文："When you play me, draw 1."
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.a / 383.4.a.1："When you play me" 是 Play Effect，即 Condition 含本单位
 *   的触发式能力；420.4.a 规定它在打出完成后进链。
 * - 时点 "card-played"（events/timing-points.ts，ruleRefs 354/420.4，由 chain/ 在链项
 *   结算完成时发出）；filter 用契约 3.6 的符号选择器 { source: "self" } 指向能力来源
 *   本体，不写运行时 ObjectRef、不写运行时 id。
 * - "draw 1" = effect.draw（414.1/414.3，已合入原语）。抽牌者缺省为能力控制者
 *   （190.6.d 的"you"），不写死玩家 id。
 *
 * 说明：body 只有一条未与任何前序指令链接的独立指令（359.2.c 的"尽可能执行"；
 * 打出触发本身不依赖其它指令的结果）。
 * 触发器 filter 的 { source: "self" } 是本仓库卡牌程序通用写法（见 bubble-bot /
 * gem-jammer / plundering-poro / rumble-hotheaded）；把 CardProgram 的触发数据注册成
 * events 的 TriggerRegistration 并解析该自指锚点的适配器仍未合入（RIFT-120 后续），
 * 所以 golden 里对端到端订阅保留 test.todo。
 */
export default {
  canonicalCardId: "card.hash-31bab80a3ed5d98ccd6492ffb83f0c7d0192f5fdd9a176cd38334395723cf7fc",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } }
      },
      optional: false,
      body: [
        {
          id: "cloud-drake.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "When you play me, draw 1."
} satisfies CardProgram;
