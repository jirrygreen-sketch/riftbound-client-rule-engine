import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Jayce, Hammer in Hand (ven-088-166) — Unit, 4 Energy + 1 Body Power, Might 5,
 * Body, tags Jayce/Piltover/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-088-166，逐字）：
 *   When I become ready, choose one to give me this turn —
 *   [Assault 2] (+2 :rb_might: while I'm an attacker.)[Deflect 2] (Opponents must
 *   pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)
 *   [Ganking] (I can move from battlefield to battlefield.)
 *
 * 规则依据（Core Rules v1.5）：
 * - "When I become ready"：416.1 / 412.4 的就绪事件；封闭时点 "object-readied"
 *   （events/timing-points.ts，ruleRefs 416.1/416.1.c）承载该触发（同 sfd/irelia-fervent
 *   的 "or ready me" 与 ogn/pirate's-haven 的 "When you ready …"）。
 * - 355.3：“choose one —” 引出模式列表；契约 3.9 的冻结形状是 choice.mode
 *   （modes: {id, body}[]、count = 1、different = true），被选模式的 body 完整保留。
 * - 807.1.b / 807.1.b.1：Assault 带数值（本例 2）；809.1.b.2：Deflect 带数值（本例 2）；
 *   810：Ganking 不带数值。三者都只是“本回合获得该关键词”，展开与叠加归
 *   effects/keywords/<keyword>.ts（契约 3.7），卡文件不重写。
 * - “this turn” 是带回合期限的授予（817 一类的临时授予；到期在回合结束清理，315.4 / 317.2.c）。
 *   授予动作是持续效果，按 layers 的 ability 层落地（契约 3.4 的图层顺序）。
 * - “give me” 是自我指代（355.10.d/g 的按特征程序化选中，不是目标选择）：
 *   continuous.grant-keyword 只接受 appliesTo self / objects / filter 等选择形状，
 *   因此用字面 appliesTo self（指令将其解析为能力来源自身）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。触发注册与 grant-keyword
 * 指令都已合入并有探针执行证据（test.mjs 的 probe 用例）；仍缺的是链适配器与
 * 关键词消费方，见 judgeReason。
 */
const mode = (id: string, keyword: string, value?: number) => ({
  id,
  body: [
    {
      id: `jayce-hammer-in-hand.grant-${id}`,
      op: "continuous.grant-keyword",
      args: {
        keyword: { kind: "constant", value: keyword },
        ...(value === undefined ? {} : { value: { kind: "constant", value } }),
        duration: { kind: "constant", value: "this-turn" },
        // “give me” 的自我指代：355.10.d/g 不是目标选择；指令把 appliesTo self
        // 解析为能力来源（resolveSelection 的 kind:"source" 分支）。
        appliesTo: { kind: "constant", value: "self" }
      }
    }
  ]
});

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-readied",
      filter: { event: "object-readied", filter: { source: "self" } }
    },
    // 印文没有 "you may"：触发本身是强制的，模式选择属于 355.3 的常规选择。
    optional: false,
    body: [
      {
        id: "jayce-hammer-in-hand.choose-one",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          modes: {
            kind: "constant",
            value: [
              mode("assault-2", "Assault", 2),
              mode("deflect-2", "Deflect", 2),
              mode("ganking", "Ganking")
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-cb3b4ba5c7faf7ff8048c29675e218c4b9fa878972899ec9a88ecfb730c74cf2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发注册与授予原语都已合入并有探针证据：object-readied 触发经 programs/triggers 注册、" +
    "就绪后进链（probe 见 test.mjs），continuous.grant-keyword 是已注册指令，" +
    "appliesTo self（355.10.d/g 自我指代）解析为来源对象。仍缺两处：" +
    "(1) 被选模式进入 Finalize 时 choice.mode 被链适配器拒绝——assertFinalizationSurface 抛 " +
    "ChainContractBlockedError('Mode choices require a Finalize/Resolve choice-plan adapter')，" +
    "模式选择无法落到被选 body；(2) 关键词消费方：Deflect 的 target.tax 管线在进行中" +
    "（RIFT-360），Assault 的战斗加成需要 807.1.d.1 的 designation 攻击方识别、" +
    "Ganking 需要 810.1.c 的战场移动许可消费方（layers 的 keywords/movement 已能承载授予结果）。" +
    "不近似实现（不把三个模式压成一个，也不把授予写成直接改 Might）。",
  abilities,
  sourceText:
    "When I become ready, choose one to give me this turn \u2014\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)" +
    "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)" +
    "[Ganking] (I can move from battlefield to battlefield.)"
} satisfies CardProgram;
