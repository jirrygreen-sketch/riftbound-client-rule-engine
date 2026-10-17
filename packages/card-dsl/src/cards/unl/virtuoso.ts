import type { CardProgram } from "../../ir/index.js";

/**
 * Virtuoso (unl-181-219) — Legend, Fury/Mind, tag Jhin.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-181-219，逐字）：
 *   When you play a spell, if you spent :rb_energy_4: or more, you may banish
 *   it. Then, if there are four spells banished with me, put each in its
 *   trash, channel 4 runes, and draw 1.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.4：“When you play a spell” 是触发条件；时点用封闭表的
 *   card-played（359 / 383.4.a / 407），filter 取事件对象为 spell（355.9 对
 *   “spell” 的用法）且控制者为能力控制者。
 * - 383.2.a.1：“if you spent [4] or more” 紧跟在触发条件之后，是触发条件的一部分，
 *   在触发时求值；需要读取“为这张刚打出的法术实际支付的 Energy 总量”。
 * - 383.3.a / 383.3.a.3 与契约 3.9：“you may banish it” 的“可以”范围需要裁定
 *   （见 judgeReason）；本程序按契约 3.9 的冻结形状，把被选指令（effect.banish）
 *   包进 choice.optional 的 body，不使用 choice + linkedTo。
 * - 394–398： “four spells banished with me” 是 Linked Ability 的作用域（与该传奇
 *   的放逐建立关联的那 4 张法术），不是普通的区域集合查询；“put each in its trash”
 *   按 CR 055/108 把每张牌移回其拥有者的 Trash。
 * - 431.1 / 431.2：“channel 4 runes” 用 effect.channel，未注明 exhausted，按
 *   431.2.a 默认就绪进入符文区；414.1 / 414.3：“draw 1” 用 effect.draw。
 * - 359.3.e.14.a-b：“Then, if …” 从句不链接到前面的可选指令：拒绝 banish 只是该
 *   指令 negated(skipped)，后续独立条件照常检查。
 *
 * status = judge-required（2026-10-16 复核：缺口不近似实现）。已合入并可执行的部分：
 * 触发本体通过 RIFT-257 的 programs/ 适配器注册到 card-played 事件（closed 词汇，
 * 金标验证 translateTriggerFilter + validateTriggerSpec 通过），choice.optional 的
 * 接受/拒绝、effect.banish、effect.channel 与 effect.draw 都走解释器/参考内核真实执行。
 * 仍然缺口的四处（逐条按当前合并源码核对）：
 * - “if you spent [4] or more”（383.2.a.1）没有求值路径：chain/engine.ts 的 Finalize 把
 *   payCostPlan 的回执存在 ChainItem.payment 上，但契约 3.6 的 ResolveContext 没有
 *   spent / finalized 费用回执读取入口，Expr/Condition 只能读对象特征、链接值与对象计数
 *   （count 只数对象、不读金额）；费用种类与 cost.pay / cost.modify 仍属尚在进行的
 *   RIFT-261。程序里的 count subject 是保留形状，不是求值。
 * - “banish it” 的 it 是触发事件里的法术对象：契约 3.6 的 ObjectSelector 只有
 *   self/source/target/pick/linked；触发快照虽然携带 PipelineEvent，但没有把它绑定成
 *   对象选择符的路径（引擎批 4 的触发事件对象/载荷选择器，RIFT-257 后续），383.2.c.3.b /
 *   359.3.f.3 要求的入链锁定还不存在。
 * - “four spells banished with me”（CR 394–398）的 Linked Ability 作用域没有合并的
 *   追踪器；“put each in its trash” 只能经 effect.zone 的 target/pick 读取，而 picks 来自
 *   Finalize 锁定的答案，不能表达“与我关联的那 4 张放逐法术”。
 * - “you may banish it” 位于效果开头、后面仍接独立的 “Then, if …” 从句：383.3.a
 *   （finalize 决定、拒绝则整条触发移出链）与 383.3.a.3（后面的 may 在结算时决定）两种读法
 *   在已有 4 张放逐法术时结果不同，需要裁定；本程序按契约 3.9 冻结形状把被选指令包进
 *   choice.optional（ability.optional=false），不宣称已裁定。
 * 另外，该 effect.banish 的 TargetSpec 嵌套在 choice.optional 的 body 内，而合并的链侧
 * assertFinalizationSurface 明确拒绝 nested/repeated targets（金标只覆盖解释器层的
 * body 执行）——即使前两条缺口解决，嵌套目标生命周期仍需链侧适配。
 *
 * 依赖：RIFT-261（费用种类 / cost.pay 的实际支付回执读取）、RIFT-257 后续（触发事件对象
 * 选择器与嵌套目标生命周期）、Linked Ability 作用域（CR 394–398）的合并实现。
 */
export default {
  canonicalCardId:
    "card.hash-cf809eb034135f7e3cd76d5eff022d2a22f25ee0fd5ce564ffc39eec131b51f6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "触发本体已可执行：RIFT-257 的 programs/ 适配器把本卡的 card-played 触发与 filter 注册进事件管线" +
    "（closed 词汇，translateTriggerFilter + validateTriggerSpec 通过），choice.optional 接受/拒绝、effect.banish、" +
    "effect.channel、effect.draw 都由解释器/参考内核真实执行（golden 覆盖）。整卡仍缺四处：" +
    "(1) “if you spent [4] or more”（383.2.a.1）没有求值路径——链侧 Finalize 虽把 payCostPlan 回执存在 ChainItem.payment，" +
    "但契约 3.6 的 ResolveContext 没有 spent / finalized 费用回执入口，Expr/Condition 只能读对象特征、链接值与对象计数" +
    "（count 只数对象、不读金额），费用种类与 cost.pay / cost.modify 仍属尚在进行的 RIFT-261；" +
    "(2) “banish it” 的 it 是触发事件里的法术对象——ObjectSelector 只有 self/source/target/pick/linked，" +
    "触发快照的 PipelineEvent 没有绑定成对象选择符的路径（引擎批 4 / RIFT-257 后续，383.2.c.3.b / 359.3.f.3）；" +
    "(3) “four spells banished with me”（CR 394–398）的 Linked Ability 作用域没有合并追踪器，effect.zone 只能经 " +
    "target/pick 读取，picks 来自 Finalize 锁定答案，无法表达关联集合；" +
    "(4) “you may banish it” 位于效果开头而后面仍接独立 “Then, if …” 从句，383.3.a（finalize 决定、拒绝即整条触发移出链）" +
    "与 383.3.a.3（结算时决定）两种读法在已有 4 张放逐法术时结果不同，需要裁定，本程序只按契约 3.9 冻结形状书写。" +
    "另外该 effect.banish 的 TargetSpec 嵌在 choice.optional body 内，链侧 assertFinalizationSurface 明确拒绝 " +
    "nested/repeated targets，嵌套目标生命周期仍需适配。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // “you play a spell”：事件对象是刚打出的法术，由能力控制者控制（383.4.a.4）。
          object: { type: "spell", controller: "self" }
        },
        // 383.2.a.1：紧跟触发条件的 “if you spent [4] or more” 属于触发条件。
        // count 表达式是保留形状（与 ogn-251-298 Loose Cannon 对无法读取的
        // 玩家侧数值的处理一致）；合并 IR 没有“实际支付金额”维度，见 judgeReason。
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "energy-spent-on-the-played-spell",
            filter: { player: "controller" }
          },
          operator: "gte",
          right: { kind: "constant", value: 4 }
        }
      },
      // “you may” 的作用域需要裁定（见 judgeReason）；按契约 3.9，被选指令写在
      // choice.optional 的 body 里，触发本身保持非可选。
      optional: false,
      body: [
        {
          id: "virtuoso.opt-banish",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Banish the spell you played?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "virtuoso.banish-spell",
                  op: "effect.banish",
                  args: {
                    // “banish it”：it = 触发事件里的法术；TargetSpec 形状见 judgeReason。
                    objects: { kind: "constant", value: { target: "played-spell" } }
                  },
                  targets: [
                    {
                      id: "played-spell",
                      filter: { type: "spell" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        },
        {
          id: "virtuoso.four-spells",
          op: "sequence",
          // “Then, if there are four spells banished with me”：独立条件，作用于
          // 后面的整组指令（359.3.e.14 下与前面的可选指令无链接）。
          condition: {
            kind: "compare",
            left: {
              kind: "count",
              subject: "spells-banished-with-me",
              // 只使用真实存在的过滤字段；“与该传奇关联”的窗口语义由 subject 名称
              // 与 judgeReason 记录（Linked Ability 追踪器未合并）。
              filter: { zone: "banishment", type: "spell" }
            },
            operator: "gte",
            right: { kind: "constant", value: 4 }
          },
          args: {
            body: {
              kind: "constant",
              value: [
                {
                  id: "virtuoso.put-in-trash",
                  op: "effect.zone",
                  args: {
                    // “put each in its trash”：its = 各牌的拥有者，区域路由由内核负责。
                    pick: { kind: "constant", value: "spells-banished-with-me" },
                    to: { kind: "constant", value: "trash" }
                  },
                  picks: [
                    {
                      id: "spells-banished-with-me",
                      // options 是“与该传奇关联的放逐法术集合”的占位条目；
                      // 真实成员由 Linked Ability 追踪器（CR 394–398）提供，尚未合并。
                      options: ["spells-banished-with-me"],
                      min: 1,
                      max: null,
                      selection: "all"
                    }
                  ]
                },
                {
                  id: "virtuoso.channel-four",
                  op: "effect.channel",
                  args: { amount: { kind: "constant", value: 4 } }
                },
                {
                  id: "virtuoso.draw-one",
                  op: "effect.draw",
                  args: { amount: { kind: "constant", value: 1 } }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play a spell, if you spent :rb_energy_4: or more, you may banish it. " +
    "Then, if there are four spells banished with me, put each in its trash, channel 4 runes, and draw 1."
} satisfies CardProgram;
