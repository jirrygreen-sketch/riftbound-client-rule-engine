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
 * - “you may return …”（403.1、契约 3.9）：效果首段是 “you may”，把被选指令写进
 *   choice.optional 的 body，而不是 choice + 后续 linkedTo。355.12 要求 may-action 的全部
 *   选择随该动作一起做，因此 “a friendly unit at a battlefield” 的 TargetSpec 挂在
 *   choice.optional 节点上、随打出一起 Finalize 锁定（与已合入 sfd-032-221 Disarming Rake 同型）。
 * - “a friendly unit at a battlefield”：由能力控制者控制、位于战场的单个单位是选目标
 *   （355.9 / 355.9.b / 355.10），不是 pick。
 * - “return … to its owner's hand”：把手牌以外的对象移回拥有者手牌（055 / 108 的区域路由与
 *   新的区域身份）由已合入的 effect.zone（to: hand → return-to-hand 动作）提交，卡牌不自己改区域。
 *
 * status = judge-required（缺口不近似实现）：
 * - [Ambush] 没有已合入的 KeywordDef：822.1.b 的额外合法打出位置与 822.1.c 的 Reaction 许可
 *   都没有展开文件与消费方（依赖 RIFT-84 的 Ambush/Hidden 关键词任务与 RIFT-89 的打出位置接线）。
 * - card-played 触发没有 CardProgram → TriggerRegistration 的注册路径（RIFT-120）。
 * 已合入并可真实执行的部分：choice.optional + effect.zone 的 may-return 半段
 * （golden 用解释器 + 参考内核执行接受 / 拒绝 / 目标失效三种分支）。
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
    // 403.1：印刷的 “you may” 属于指令级的可选执行，触发本身不是可选的。
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
              controller: "controller",
              location: { type: "battlefield" }
            },
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
    "[Ambush]（822.1.b/822.1.c）没有已合入的 KeywordDef：822.1.b 的「打到你有单位的战场」额外合法打出位置" +
    "与 822.1.c 的 Reaction 许可都只有卡面声明，没有关键词展开文件与打出位置/时机消费方（依赖 RIFT-84 的 " +
    "Ambush/Hidden 关键词任务与 RIFT-89 的打出位置接线）；card-played 触发也没有 CardProgram → " +
    "TriggerRegistration 的注册路径（RIFT-120）。" +
    "「When you play me, you may return a friendly unit at a battlefield to its owner's hand.」半段本身已合入：" +
    "403.1 / 契约 3.9 的 choice.optional（被选指令包进 body）+ effect.zone（to: hand，055/108 的拥有者回手路由），" +
    "golden 用解释器 + 参考内核真实执行接受 / 拒绝 / 目标失效三种分支。",
  abilities,
  sourceText:
    "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
    "When you play me, you may return a friendly unit at a battlefield to its owner's hand."
} satisfies CardProgram;

export default program;
