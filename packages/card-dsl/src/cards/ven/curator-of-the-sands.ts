import type { CardProgram } from "../../ir/index.js";

/**
 * Curator of the Sands (ven-145-166) — Legend, Calm/Mind, tag Nasus.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-145-166，逐字）：
 *   When you play a unit, gear, or activated ability with Energy cost
 *   :rb_energy_7: or more, you may exhaust me to ready up to 2 runes.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.1 / 383.2.a / 383.4.a / 407：句首 “When you play a unit, gear, or activated
 *   ability” 是触发条件；打出卡牌用封闭时点 card-played（359、383.4.a、407）观察，
 *   打出启动能力用 ability-activated（400、402、405–407）观察。
 * - 206 / 206.1：“with Energy cost 7 or more” 读取的是印刷（或用复制效果后的复制）
 *   费用，能力则是 base cost，忽略任何增减（CR 1217–1221 以本卡原文为示例）。
 * - 383.3.a / 383.3.b / 403.1：“you may” 位于效果开头，其后的 “exhaust me” 是效果开头
 *   的 cost within instructions，按规则是该触发能力的基础费用，必须在 Finalize 支付，
 *   无法支付则该触发移出链（404.1.b.1 同型）。
 * - 355.12 / 355.13 / 359.3.e.7：“ready up to 2 runes” 对最多两个 Game Object 执行
 *   Ready，属于选目标且可以在 Finalize 选择任意数量（含 0）；effect.ready（416.1–416.3）
 *   已合入可执行该子效果。
 *
 * status = judge-required（四处缺口均不近似实现）：
 * 1. 触发条件 “with Energy cost 7 or more” 无可求值路径：合并 IR 的 Expr / Condition
 *    只能读对象特征、链接值与对象计数，读不到刚打出的牌或刚启动能力的印刷/basis Energy
 *    费用；card-played 与 ability-activated 的载荷都不带费用回执（契约 3.6 的
 *    ResolveContext 也没有对应入口）。程序以描述性过滤键记录门槛，并在 golden 里断言
 *    严格触发器校验器拒绝该形状。
 * 2. 触发条件的 “unit, gear, or activated ability” 是一个跨两个时点的析取：单个
 *    TriggerSpec 只能订阅一个 at（契约 3.1/3.5），本程序因此把卡牌打出这一半写成
 *    card-played 订阅，另一半（启动能力）需要 ability-activated 订阅；而合并内核目前
 *    没有任何产者发出 ability-activated（只有 chain/engine.ts 发出 card-played），
 *    启动能力 → 链的接线（RIFT-89）未合入。
 * 3. “exhaust me” 的规则身份是基础费用（383.3.b），但契约 3.1 的 TriggeredAbility 没有
 *    CostSpec 字段；body 里以 effect.exhaust 的非目标 choose 形状记录该动作，不能替代
 *    Finalize 的费用检查（“已横置时不能支付”，415.4/415.5）。另外合并解释器的链适配器
 *    （chain/interpreter-adapter.ts 的 LITERAL_FIELDS）只解包 effect.exhaust 的
 *    target/pick/choice，不解包 choose，所以这条占位指令在生产链路上也无法执行。
 * 4. Rune 的位置语义需要裁定：107.1.c 规定 Runes 位于其控制者的 Base，而冻结契约的
 *    ZoneId 用 rune-zone 表示符文区；target 过滤器同时写 type: "rune" 与 zone:
 *    "rune-zone" 表达“你控制的在符文区/Base 的 Rune”，该读法由目标管线在 Base 位置
 *    语义落地时复核。
 * 依赖：事件载荷 / 费用回执（契约变更请求）、RIFT-89（费用与启动接线）；effect.ready
 * 子效果已合入，golden 用真实解释器 + 参考内核执行。
 */
const curatorOfTheSands = {
  canonicalCardId: "card.hash-913749be19f87a0f632bd0690ad0490bb254a346584c09e1b8c3244137f609a7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) 触发条件 “with Energy cost :rb_energy_7: or more” 无可求值路径——206/206.1 要求读取" +
    "刚打出的牌/刚启动能力的印刷或 base Energy 费用，而合并 IR 的 Expr/Condition 只能读对象特征、链接值与对象计数，" +
    "card-played / ability-activated 载荷都不带费用回执，ResolveContext 也没有该入口；程序以描述性过滤键 " +
    "energyCostAtLeast 与 playedCardTypes 记录门槛（严格触发器校验器会以 unknown-field 拒绝，golden 断言该拒绝）。 " +
    "(2) “unit, gear, or activated ability” 是跨两个时点（card-played 与 ability-activated）的析取，" +
    "单个 TriggerSpec 只能订阅一个 at；本程序写出 card-played 这一半，另一半需要 ability-activated 订阅，" +
    "而合并内核没有产者发出 ability-activated（只有 chain/engine.ts 发 card-played），启动能力 → 链的接线（RIFT-89）未合入。 " +
    "(3) “exhaust me” 的规则身份是触发能力的基础费用（383.3.b），但契约 3.1 的 TriggeredAbility 没有 CostSpec 字段；" +
    "body 以 effect.exhaust 的非目标 choose 形状记录动作，无法替代 Finalize 的费用检查（415.4/415.5），" +
    "且链适配器 LITERAL_FIELDS 不解包 effect.exhaust 的 choose，生产链路上同样执行不了。 " +
    "(4) “runes” 的位置读法需要裁定：107.1.c 说 Runes 位于控制者的 Base，冻结契约的 ZoneId 用 rune-zone 表示符文区，" +
    "target 过滤器同时写 type: \"rune\" 与 zone: \"rune-zone\"，待目标管线确认 Base 位置语义。 " +
    "依赖事件载荷 / 费用回执（契约变更请求）与 RIFT-89；effect.ready 子效果已合入，golden 用真实解释器执行。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          filter: {
            // “you play a unit, gear, or activated ability”：卡牌打出这一半的对象是
            // 你打出的 unit / gear（spell 不属于原文列举）。说明：card-dsl 校验器把 object
            // 视为对象选择器锚点，不能承载嵌套 ObjectFilter，故以描述性扁平键记录类型白名单。
            playedCardTypes: ["unit", "gear"],
            controller: "self",
            player: "self",
            // “with Energy cost :rb_energy_7: or more”：按 206/206.1 读印刷/base 费用；
            // 该检查在合并 IR 里无法求值，仅以描述性键保留门槛（见 judgeReason 第 1 条）。
            energyCostAtLeast: 7
          }
        }
      },
      // “you may” 在效果开头（383.3.a）：其后的 “exhaust me” 是基础费用，不是可选指令，
      // 因此这里不写 ability.optional，也不包 choice.optional；费用形状见 judgeReason 第 3 条。
      optional: false,
      body: [
        {
          id: "curator-of-the-sands.exhaust-self",
          op: "effect.exhaust",
          // “exhaust me”：以非目标 choose 的 filter 锚点指向来源自身（355.10.c：费用里提到的
          // 对象不是目标）。真实的 Finalize 费用语义见 judgeReason 第 3 条。
          args: {
            choose: {
              kind: "constant",
              value: { id: "curator-of-the-sands.exhaust-self", filter: { object: "self" } }
            }
          }
        },
        {
          id: "curator-of-the-sands.ready-runes",
          op: "effect.ready",
          // “ready up to 2 runes”：355.12/355.13 的 up-to 选目标（可选任意数量，含 0）。
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "curator-of-the-sands.runes" }
            },
            amount: { kind: "constant", value: 2 }
          },
          targets: [
            {
              id: "curator-of-the-sands.runes",
              // “runes”（你控制的 Rune）：type/controller 是真实过滤字段；zone 的读法见
              // judgeReason 第 4 条。
              filter: { type: "rune", zone: "rune-zone", controller: "self" },
              min: 0,
              max: 2,
              selection: "up-to"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When you play a unit, gear, or activated ability with Energy cost :rb_energy_7: or more, " +
    "you may exhaust me to ready up to 2 runes."
} satisfies CardProgram;

export default curatorOfTheSands;
