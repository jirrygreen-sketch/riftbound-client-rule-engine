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
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（缺口见 judgeReason；
 * 本卡没有任何已合入的可执行语句，因此 golden 只做结构/关键词身份断言，未合入依赖写 test.todo）。
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
        // "give me" 是自我指代：355.10.d/g 的按特征程序化选中，不是目标选择，
        // 因此用契约 3.6 的符号选择器 source（能力来源）而不是 TargetSpec。
        object: { kind: "constant", value: { kind: "source" } }
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
    "三处缺口：(1) 带 end-of-turn 期限的关键词授予需要卡牌侧的 continuous.grant-keyword 指令原语：" +
    "effects/instructions/ 下只有 effect.* 文件，没有该 op（RIFT-91 只合入 layers 引擎与 duration 机制，" +
    "卡牌入口缺失；同 sfd/block、ven/heart-of-the-tempest 的缺口），三个模式的授予都不可执行；" +
    "(2) object-readied 触发进不了链——时点已在封闭枚举中（416.1/416.1.c），但没有已合入订阅方把 " +
    "CardProgram 的 triggered ability 注册成 TriggerRegistration（chain/engine.ts 只注册延迟触发；" +
    "RIFT-120，契约 §7.2 批 5）；(3) 关键词展开的消费方未接通：Assault 的 continuous.might + " +
    "attacker 条件与 Shield/Assault 的 designation 读取（807.1.d.1）、Deflect 的 target.tax（809.1.c.1，" +
    "RIFT-90）、Ganking 的 continuous.movement 许可（810.1.c）在合并代码里都没有求值方（RIFT-91）。" +
    "已按契约 3.9 写出 choice.mode 的模式列表与被选 body，依赖落地后可直接复核。不近似实现（不把三个" +
    "模式压成一个，也不把授予写成直接改 Might）。",
  abilities,
  sourceText:
    "When I become ready, choose one to give me this turn \u2014\n" +
    "[Assault 2] (+2 :rb_might: while I'm an attacker.)" +
    "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)" +
    "[Ganking] (I can move from battlefield to battlefield.)"
} satisfies CardProgram;
