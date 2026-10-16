import type { CardProgram } from "../../ir/index.js";

/**
 * Forgotten Signpost (unl-045-219) — Gear, 2 energy、power null（无印刷 Power）、
 * Might null，领域 Calm，无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json unl-045-219）：
 *   "[Action][>] Exhaust a unit you control, :rb_exhaust:: Move a different unit you
 *    control to the location of the unit you exhausted to pay for this ability."
 *
 * 规则依据（CR v1.5）：
 * - 813.1.a / 813.1.d：能力上的 “[Action][>]” 是许可类关键词的速度声明，IR 用
 *   activated.timing = "action" 表达；启动能力本身按 377.1 以 “:” 划分费用与效果。
 * - 377 / 404.1.a / 415.5：冒号之前是费用——“Exhaust a unit you control” 加横置来源。
 *   这是 355.10.c.1 的成本内指令（"[do X] to [do Y]" 的 X 部分），付费时选择的对象
 *   不是能力目标（355.10.c），因此以非目标的 cost choice / PickSpec 描述，
 *   不用 effect.exhaust 写在结算正文里（cost/plan-values.ts 的 exhaust 支付种类支持
 *   object/choice/amount，见已合入 ogn/meditation、rad/starry-eyed-songstress 先例）。
 * - 415.3.a / 415.4：横置作为费用必须能完成（来源已横置则不能支付）；费用在 Finalize
 *   支付，付不出就不能激活。
 * - “Move a different unit you control to the location of the unit you exhausted” 是效果：
 *   355.10 / 355.9.a.1 规定“unit”默认指 Board 上的对象，且这里由玩家选择，因此被移动的
 *   单位是目标（targets），不是 pick。目的地是“费用里横置的那个单位所在的位置”，
 *   需要从费用选择的结果读取位置（见 judgeReason）。
 * - “to pay for this ability” 是规则提示语，不是额外指令；括号外整句只有一条效果。
 *
 * status = judge-required（缺口不近似实现）：
 * - 目的地不可表达：CR 355.4 要求效果指出目的地，而“the location of the unit you
 *   exhausted” 是费用选择对象的运行期位置。契约 3.6 的 ObjectSelector 只有
 *   self/source/target/pick/linked；费用选择的引用对 ResolveContext 不可见
 *   （ctx.picks 只反映 PickSpec，费用 choice 的答案不进链接值），effect.move 的 to
 *   只接受静态 LocationRef / controller-base / 静态候选列表，没有“某对象的当前位置”
 *   选择器。写死某个基地/战场会移动错地点，不近似。
 * - 费用内的横置选择也没有卡牌可读的接线：CostSpec 的 payments 只能携带静态
 *   PickSpec/options，运行期的 Board 单位集合无法在静态 IR 里枚举（本程序用
 *   options 占位标记，见回复的契约变更请求）。
 * - 缺少卡牌程序 → 启动能力注册/费用计划 → 链的接线（契约 3.5）。
 * 依赖：RIFT-89/90（费用选择结果与位置读取、目标/目的地计划）。effect.move 本体的
 * move-location 部分已合入，golden 用参考内核执行静态目的地的对照场景。
 */
export default {
  canonicalCardId:
    "card.hash-a6a251b556aa4fc7a6c80ebb32af7c401203008d9b475d8097cfe1f9b416ed90",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) “Move … to the location of the unit you exhausted” 的目的地不可表达：该位置来自费用内指令所选单位的运行期位置（CR 355.4），" +
    "而契约 3.6 的 ObjectSelector 只有 self/source/target/pick/linked，费用选择的结果既不是 target 也不是 pick，" +
    "ResolveContext 没有读取费用选择引用的入口；effect.move 的 to 只接受静态 LocationRef / controller-base / 静态候选列表，" +
    "写死某个基地或战场会移动到错误地点。" +
    "(2) 费用内的 “Exhaust a unit you control” 需要运行期的 Board 单位集合作为 CostSpec 选择集合，静态 IR 无法枚举（本程序只用占位 options 标记形状）。" +
    "(3) 缺少卡牌程序 → 启动能力注册/费用计划 → 链的接线（契约 3.5）。" +
    "依赖 RIFT-89/90（费用选择结果回执、位置选择器与目标/目的地计划）；不近似实现。",
  abilities: [
    {
      kind: "activated",
      // 813.1.d：“[Action][>]” 是能力上的速度许可，IR 直接声明 action。
      timing: "action",
      cost: {
        kind: "activated",
        payments: [
          {
            // 355.10.c.1 / 404.1.a：冒号之前的 “Exhaust a unit you control” 是费用；
            // 付费时选择的对象不是目标（355.10.c），因此用非目标的 choice。
            kind: "exhaust",
            // 数量是 Expr：cost/plan-values.ts 的 readCost 经 ctx.evaluate 求值
            // （spend-buff 以外，amount 必须等于所选对象数）。
            amount: { kind: "constant", value: 1 },
            choice: {
              id: "forgotten-signpost.exhausted-unit",
              // 运行期 Board 单位集合无法在静态 IR 里枚举，占位标记形状（见 judgeReason 第 2 点）。
              options: ["runtime:controller-units"],
              min: 1,
              max: 1,
              selection: "one",
              filter: { type: "unit", controller: "controller", zone: "board" }
            }
          },
          // “, :rb_exhaust:” 的第二段费用：横置来源自身（415.3.a / 415.5）。
          { kind: "exhaust", object: "self" }
        ]
      },
      body: [
        {
          id: "forgotten-signpost.move-unit",
          op: "effect.move",
          args: {
            // “Move a different unit you control”：被移动的单位由玩家选择（355.10），
            // 是指向 Board 上友方单位的目标。
            objects: {
              kind: "constant",
              value: { target: "forgotten-signpost.moved-unit" }
            },
            // 目的地是“被横置单位的位置”，当前 IR 无法表达（见 judgeReason 第 1 点）：
            // 保留描述性标记，不写死某个地点。
            to: {
              kind: "constant",
              value: {
                kind: "location-of",
                object: { kind: "cost-choice", id: "forgotten-signpost.exhausted-unit" }
              }
            },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "forgotten-signpost.moved-unit",
              filter: { type: "unit", controller: "controller", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Action][>] Exhaust a unit you control, :rb_exhaust:: Move a different unit you control to the location of the unit you exhausted to pay for this ability."
} satisfies CardProgram;
