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
 * 复核（2026-10-17，第一轮 M2 覆盖率复核；逐条对照旧 judgeReason）：
 * - 旧第 2 条已过时：ability-activated 时点有产者了——events/producers/ability-activation.ts
 *   的 deriveAbilityActivatedEmission 在 Chain 合法完成后发出该时点（RIFT-270 审计的清单里
 *   也记为“本任务新增”；RIFT-120 的链与事件单管线已合入）。但跨时点析取本身仍是缺口：
 *   契约 3.1 的 TriggeredAbility 只有一个 `at`（3.5 的 TriggerSpec 亦然）。
 * - 旧第 3 条仍成立且更具体：effect.exhaust 的 argsSchema 接受字面 choose 形状，
 *   但生产链适配器（chain/interpreter-adapter.ts 的 LITERAL_FIELDS）只解包 effect.exhaust 的
 *   target/pick/choice，不解包 choose：程序把 args 写成 Expr 后，choose 仍是
 *   { kind: "constant", value: … } 包封，schema 会以「requires a stable non-empty choice id」
 *   拒绝（golden 用生产链适配器断言该失败，并用解包后的字面形状证明原语本体可执行）。
 *   「exhaust me」的规则身份仍是基础费用（383.3.b），契约 3.1 的 TriggeredAbility 没有
 *   CostSpec 字段，因此无法按 Finalize 费用支付（“已横置时不能支付”，415.4/415.5）。
 * - 旧第 1、4 条保持：触发条件 “with Energy cost 7 or more” 无可求值路径（206/206.1 要读
 *   刚打出的牌或刚启动能力的印刷/base Energy 费用，Expr/Condition 读不到，事件载荷里也没有
 *   费用回执）；“runes” 的位置读法（107.1.c 的 Base vs 契约的 rune-zone）仍待目标管线裁定。
 * effect.ready 子效果已合入，golden 用真实解释器 + 参考内核执行（含 up-to 2、已就绪不重复、
 * 目标失效三种边界）。
 *
 * status = judge-required（四处缺口）：
 * 1. 触发条件 “with Energy cost :rb_energy_7: or more” 无可求值路径：206/206.1 要求读取刚打出的牌/
 *    刚启动能力的印刷或 base Energy 费用，而 Expr / Condition 只能读对象特征、链接值与对象计数，
 *    card-played / ability-activated 的载荷都不带费用回执。程序以描述性过滤键 energyCostAtLeast /
 *    playedCardTypes 记录门槛（严格触发器校验器会以 unknown-field 拒绝，golden 断言该拒绝）。
 * 2. “unit, gear, or activated ability” 是跨两个时点（card-played 与 ability-activated）的析取，
 *    单个 TriggerSpec 只能订阅一个 at；本程序写出 card-played 这一半，另一半需要第二个订阅。
 * 3. “exhaust me” 是触发能力的基础费用（383.3.b），但 TriggeredAbility 没有 CostSpec 字段；
 *    body 以 effect.exhaust 的 choose 形状记录该动作，但生产链适配器不解包该键，Expr 包封会被
 *    argsSchema 拒绝（golden 用生产链适配器断言），且该形状也无法替代 Finalize 的费用检查（415.4/415.5）。
 * 4. Rune 的位置语义需要裁定：107.1.c 规定 Runes 位于其控制者的 Base，而冻结契约的 ZoneId 用
 *    rune-zone 表示符文区；target 过滤器同时写 type: "rune" 与 zone: "rune-zone"。
 * 依赖：事件载荷 / 费用回执（契约变更请求）与 trigger 侧的基础费用形状；effect.ready 子效果已合入。
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
    "单个 TriggerSpec 只能订阅一个 at；本程序写出 card-played 这一半，另一半需要第二个 ability-activated 订阅" +
    "（该时点已由 events/producers/ability-activation.ts 在链合法完成后发出，但一个 TriggerSpec 装不下析取）。 " +
    "(3) “exhaust me” 的规则身份是触发能力的基础费用（383.3.b），但契约 3.1 的 TriggeredAbility 没有 CostSpec 字段；" +
    "body 以 effect.exhaust 的 choose 形状记录动作，但生产链适配器（chain/interpreter-adapter.ts 的 " +
    "LITERAL_FIELDS）只解包 target/pick/choice、不解包 choose，Expr 包封会被 argsSchema 以" +
    "「requires a stable non-empty choice id」拒绝（golden 用生产链适配器断言该失败），" +
    "且该形状也无法替代 Finalize 的费用检查（415.4/415.5）。 " +
    "(4) “runes” 的位置读法需要裁定：107.1.c 说 Runes 位于控制者的 Base，冻结契约的 ZoneId 用 rune-zone 表示符文区，" +
    "target 过滤器同时写 type: \"rune\" 与 zone: \"rune-zone\"，待目标管线确认 Base 位置语义。 " +
    "依赖事件载荷 / 费用回执（契约变更请求）与 trigger 侧的基础费用形状；effect.ready 子效果已合入，golden 用真实解释器执行。不近似实现。",
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
