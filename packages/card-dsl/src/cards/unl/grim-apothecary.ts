import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Grim Apothecary (unl-021-219) — Unit, 3 energy, no printed power, Might 3,
 * Fury, tag Noxus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-021-219，逐字）：
 *   [Ambush] (You may play me as a [Reaction] to a battlefield where you have
 *   units.)
 *   When you play me, you may return a friendly unit at a battlefield to its
 *   owner's hand.
 *
 * 规则依据（CR v1.5）：
 * - [Ambush]（822.1.b / 822.1.c）：给单位增加“打到你有单位的战场”这一额外合法打出位置，
 *   并在此时赋予 [Reaction] 许可的被动关键词；822.2 多个实例冗余。卡牌只声明 keyword
 *   （契约 3.7、README 第 5 节），展开归 effects/keywords/<keyword>.ts。
 * - “When you play me”（383.4.a.1 / 383.4.a.2）：打出后进链的 Play Effect，时点用封闭表的
 *   card-played，filter 指向本卡为事件来源。
 * - “you may return …”（383.3.a、403.1、契约 3.9）：首段 “you may” 应在触发 Finalize 决定；
 *   现有声明保留 choice.optional 的 body，缺生产适配（见 judgeReason）。355.12 要求 may-action 的全部
 *   选择随该动作一起做，因此 “a friendly unit at a battlefield” 的 TargetSpec 挂在
 *   choice.optional 节点上、随打出一起 Finalize 锁定（与已合入 sfd-032-221 Disarming Rake 同型）。
 * - “a friendly unit at a battlefield”：由能力控制者控制、位于战场的单个单位是选目标
 *   （355.9 / 355.9.b / 355.10），不是 pick。
 * - “return … to its owner's hand”：把手牌以外的对象移回拥有者手牌（055 / 108 的区域路由与
 *   新的区域身份）由已合入的 effect.zone（to: hand → return-to-hand 动作）提交，卡牌不自己改区域。
 *
 * status = judge-required：
 * - Ambush 的 play-location-permission 尚无 programs/statics.ts 图层映射和
 *   Finalize/playLocations 消费方；822.1.b/822.3 的「你有单位的战场」需要在 Finalize 重验。
 * - continuous.timing 的位置限定尚未绑定到该次打出；actionTimings/canAct 读取 grants
 *   不能证明地点限定的 Reaction 许可已实现（822.1.b/c）。
 * - 前置 you may 尚未转为 TriggerRegistration.mayAtFinalize，当前只在 Resolve 决定回手（383.3.a）。
 * card-played 的目标翻译、TargetSpec.location 与可选回手子效果保持真实执行测试。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "ambush" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // 383.4.a.1：“When you play me” 是 Play Effect，事件来源是本卡。
      filter: { event: "card-played", filter: { source: "self" } }
    },
    // 保留当前声明；383.3.a 的前置 may 尚未绑定为 Finalize 决定（见 judgeReason）。
    optional: false,
    body: [
      {
        id: "grim-apothecary.may-return-unit",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Return a friendly unit at a battlefield to its owner's hand?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "grim-apothecary.return-unit",
                op: "effect.zone",
                args: {
                  target: { kind: "constant", value: "grim-apothecary.friendly-unit" },
                  to: { kind: "constant", value: "hand" }
                }
              }
            ]
          }
        },
        targets: [
          {
            id: "grim-apothecary.friendly-unit",
            // 355.9 / 355.9.b / 355.10：由能力控制者控制、位于战场的单位。
            filter: {
              type: "unit",
              controller: "controller"
            },
            location: { type: "battlefield" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-1c525c2b78fb1d50e4a202311b690745a0ec7d167eb90caa663d6c63031d10e4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 [Ambush] 的 play-location-permission 生产消费（CR 822.1.b/822.1.c、822.3）：programs/statics.ts 没有该声明的图层映射，Finalize/playLocations 未据此提供并重验「你有单位的战场」。continuous.timing 的 location 也未绑定到本次打出位置；actionTimings/canAct 的 grants 查询不能实现仅在该位置打出时拥有 Reaction 的限定。另缺前置 you may 的 Finalize 决定（383.3.a）：programs/triggers.ts 未生成 mayAtFinalize，当前 optional:false + choice.optional 只在 Resolve 决定回手。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When you play me, you may return a friendly unit at a battlefield to its owner's hand."
} satisfies CardProgram;

export default program;
