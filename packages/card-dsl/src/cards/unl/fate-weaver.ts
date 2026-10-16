import type { CardProgram } from "../../ir/index.js";

/**
 * Fate Weaver (unl-064-219) — Unit，5 能量、无印刷 Power、Might 4，Mind / Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-064-219，逐字）：
 *   When you play me, look at the top 4 cards of your Main Deck. You may reveal
 *   a spell with Energy cost :rb_energy_4: or more from among them and draw it.
 *   Recycle the rest.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a："When you play me" 是 Play Effect（永久物进场后作为 Pending Item 入链），
 *   时点取封闭枚举里的 card-played，filter 指向本卡自身。
 * - 128.3–128.4 / 432.1.c："look at the top 4 cards of your Main Deck" 是私下查看；
 *   查看不改变区域、不触发 Burn Out；牌库顶顺序只能用区域顺序读取（契约 3.6 的
 *   zoneSlice 语义），不能从集合查询推断顺序。
 * - 383.3.a.3 / 契约 3.9：这里的 "you may" 不在效果开头（前面已有查看指令），
 *   所以在**结算时**决定；按契约 3.9 的冻结形状，把被选指令（reveal + 取走该牌）
 *   包进 choice.optional 的 body，而不是写成 choice + linkedTo。
 * - 425.1 / 425.2.a："reveal … from among them" 是把该牌对全体公开（425.4.a：
 *   展示后就可见的牌继续移动由后续指令处理）；"draw it" 指把这一张被展示的牌
 *   拿进手牌（414.1）。
 * - 417.1 / 417.1.a / 417.4 / 417.6："Recycle the rest" 把其余看过的牌回收到
 *   拥有者 Main Deck 底；作为效果的一部分尽可能回收。它不链接前一条可选指令：
 *   拒绝 reveal 只是那条指令 negated(skipped)，回收照常结算（359.3.e.14）。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. 「按牌库顶顺序取前 4 张」没有已合入的上游有序选择：effect.inspect 的 top 作用域
 *    自身文档要求上游提供有序 picksSpecId，缺有序来源时按契约 negated/impossible 阻断
 *    （query 不保证区域顺序）；RIFT-66 只把 zoneSlice 接进了 mill / order / recycle，
 *    链的 Finalize 也只锁定 instruction.targets 的 TargetSpec（无有序区域 picks 的
 *    生命周期，RIFT-90）。
 * 2. 「a spell with Energy cost :rb_energy_4: or more」缺数值下限过滤：ObjectFilter /
 *    TargetSpec / PickSpec 的取值是静态数据，没有「energy ≥ 4」的关系比较写法，
 *    Condition 也不能过滤选择集合的成员。
 * 3. 「reveal … and draw it」的 effect.reveal 用 pick 选择器时，链式适配器
 *    （chain/interpreter-adapter.ts 的 LITERAL_FIELDS）不解码 effect.reveal 的 pick
 *    字段，原语会以 "pick must be a non-empty id" 拒绝派发——卡牌侧按契约 3.2 的
 *    Expr 形状书写，接口不一致已在回复里提交契约变更请求。
 *
 * 依赖：RIFT-64 / RIFT-66（有序牌库顶查看）、RIFT-90（pick 生命周期与选择过滤）、
 * effect.reveal 的适配器字段。golden 用解释器 + 参考内核真实执行已支持部分
 * （有序/空范围两条 look 路径、draw it 的 pick→hand、recycle the rest）。
 */
const fateWeaver = {
  canonicalCardId: "card.hash-2bf8cfce91a22dad7d6fac1d1346fdddb3ac5cb4e68f17df57409a63ae23f366",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1)「按牌库顶顺序取前 4 张」需要上游有序 picksSpecId（effect.inspect 的 top 作用域在缺有序来源时按契约 negated/impossible 阻断；query 不保证区域顺序），" +
    "RIFT-66 的 zoneSlice 只接进 mill/order/recycle，链的 Finalize 也没有有序区域 picks 的生命周期（RIFT-90）；" +
    "(2)「a spell with Energy cost :rb_energy_4: or more」缺数值下限过滤：ObjectFilter/TargetSpec/PickSpec 是静态数据，没有 energy ≥ 4 的关系比较，Condition 也不能过滤选择集合成员；" +
    "(3)「reveal … and draw it」的 effect.reveal 走 pick 时，链式适配器（chain/interpreter-adapter.ts 的 LITERAL_FIELDS）不解码 pick 字段，原语以 \"pick must be a non-empty id\" 拒绝派发（接口不一致，见契约变更请求）。" +
    "依赖：RIFT-64/66、RIFT-90、effect.reveal 的适配器字段。look 的两条路径、draw it、recycle the rest 已在 golden 中真实执行。",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { event: "card-played", filter: { role: "self" } } },
      optional: false,
      body: [
        {
          id: "fate-weaver.bind-controller",
          // effect.inspect 要求显式 player 表达式（"your Main Deck" 的 you=能力控制者，
          // 190.6.d）；契约 3.6 的符号选择器 "source" 由解释器求值为控制者，再经
          // condition.value 绑定给后续指令读取（与已合入 sfd/stacked-deck 同一写法）。
          op: "condition.value",
          args: {
            value: { kind: "object-property", object: "source", property: "controller" },
            key: { kind: "constant", value: "controller" }
          }
        },
        {
          id: "fate-weaver.look-top-4",
          op: "effect.inspect",
          linkedTo: "fate-weaver.bind-controller",
          args: {
            player: {
              kind: "linked-value",
              instructionId: "fate-weaver.bind-controller",
              key: "controller"
            },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 4 },
            picksSpecId: { kind: "constant", value: "fate-weaver.looked" },
            linkedKey: { kind: "constant", value: "lookedCount" },
            pickedKey: { kind: "constant", value: "looked" }
          },
          picks: [
            {
              id: "fate-weaver.looked",
              // 牌库顶前 4 张（含顺序），由上游按 zoneSlice 的真实区域顺序提供；
              // 这里只描述集合的来源，不从 query 推断顺序。
              options: ["top-4-cards-of-your-main-deck-in-zone-order"],
              min: 4,
              max: 4,
              selection: "all",
              filter: { owner: "self", zone: "deck" }
            }
          ]
        },
        {
          id: "fate-weaver.may-reveal-spell",
          op: "choice.optional",
          linkedTo: "fate-weaver.look-top-4",
          args: {
            prompt: {
              kind: "constant",
              value: "Reveal a spell with Energy cost 4 or more from among them and draw it?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "fate-weaver.reveal-spell",
                  op: "effect.reveal",
                  // "from among them"：被展示的牌从刚看过的集合里选，是私下集合里的
                  // 非目标选择（355.10.a），用 pick 而不是 targets。
                  args: { pick: { kind: "constant", value: "fate-weaver.chosen-spell" } },
                  picks: [
                    {
                      id: "fate-weaver.chosen-spell",
                      options: [
                        {
                          kind: "linked-value",
                          instructionId: "fate-weaver.look-top-4",
                          key: "looked"
                        }
                      ],
                      // "a spell with Energy cost 4 or more"：type 可判定；
                      // 数值下限是静态过滤器的缺口，用描述键记录（见 judgeReason），
                      // 不把它当作已生效的限制。
                      filter: { type: "spell", energyAtLeast: 4 },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  id: "fate-weaver.draw-it",
                  op: "effect.zone",
                  linkedTo: "fate-weaver.reveal-spell",
                  args: {
                    // "draw it" 指把那一张被展示的牌拿进手牌（414.1/425.4.a）。
                    pick: { kind: "constant", value: "fate-weaver.chosen-spell" },
                    to: { kind: "constant", value: "hand" },
                    amount: { kind: "constant", value: 1 }
                  }
                }
              ]
            }
          }
        },
        {
          id: "fate-weaver.recycle-rest",
          op: "effect.recycle",
          // "Recycle the rest"：不链接可选指令——拒绝 reveal 时只是那条指令
          // negated(skipped)，其余看过的牌照常回收（359.3.e.14）。
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "fate-weaver.look-top-4",
              key: "looked"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play me, look at the top 4 cards of your Main Deck. You may reveal a spell with Energy cost :rb_energy_4: or more from among them and draw it. Recycle the rest."
} satisfies CardProgram;

export default fateWeaver;
