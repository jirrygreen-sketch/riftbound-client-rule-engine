import type { CardProgram } from "../../ir/index.js";

/**
 * Hostile Takeover (sfd-202-221) — Spell, 5 energy + 2 Mind power, tags
 * Renata Glasc/Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-202-221，逐字）:
 *   "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *    Take control of an enemy unit at a battlefield. Ready it. (Start a combat if
 *    other enemies are there. Otherwise, conquer.)
 *    Lose control of that unit and recall it at end of turn. (Send it to base.
 *    This isn't a move.)"
 *
 * 规则依据（CR v1.5）：
 * - "[Hidden]"（811）只声明关键词；展开由 effects/keywords/Hidden.ts 负责（contract 3.7）。
 * - "Take control of an enemy unit at a battlefield"：被点名的敌方单位是目标（355.7；
 *   355.9.a.1 的 unit 指 Board 对象；355.9.b 要求符合限制）。"at a battlefield" 是目标限制
 *   （355.10.b），用已合入的过滤器键 location: "battlefield" 表达（layers/filter.ts 与快照的
 *   location.type 比较，chain 的查询路径走该匹配器）。控制变更本身是封闭 GameAction
 *   take-control（契约 3.6），由已合入的 effect.control 提交；单位在战场易主时给该战场附加
 *   Contested 状态属内核流程义务（190.3.a.2，effect.control 文档明确不越界）。
 * - 提醒文字 "(Start a combat if other enemies are there. Otherwise, conquer.)" 按 135.2.d.3
 *   不具有规则效力，卡程序不为它写任何指令；战斗/征服流程归 combat/scoring。
 * - "Ready it."："it" 回指该单位，用同一个 TargetSpec 的符号选择器读取（契约 3.6）。
 *   它与控制指令不写 linkedTo：359.3.e.14.b 的 Ride the Wind 示例规定前一句的动作被 negated 时
 *   后一句仍然执行（照常尽可能执行），链接会把两句绑成同一结果，反而偏离规则。
 * - "Lose control of that unit and recall it at end of turn." 按 391.2 是该咒语结算时创建的
 *   Delayed Ability（392/393：由效果创建、不依附于战场上的卡；359.3.e.16 的示例正是本卡），
 *   因此在 body 里记为待落地的 trigger.delayed 指令（RIFT-9 清单中的 trigger.delayed），
 *   不写成卡自身的被动触发。其 body 的两条指令：把控制权交回原控制者（此处读 take-control
 *   收据的 owner）与 Recall（457：把永久物移到其 Base，458 明确不是 Move、458.1 不触发 Move
 *   能力、458.3 不受移动限制、460/460.1 保留伤害与状态）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，三处缺口，均不近似实现：
 * (1) [Hidden] 的可执行路径缺失：keywords/Hidden.ts 的展开依赖 cost.hidden 的 Hide 行动、
 *     facedown 区域限制与从 facedown 免费打出（RIFT-89），以及后续 Reaction 的 continuous.timing
 *     时机许可（RIFT-91）——与已合入的 ogn-168-298 Fight or Flight / sfd-070-221 Wages of Pain
 *     同一口径。
 * (2) "at end of turn" 的延迟注册缺卡牌可用 op：ResolveContext.registerDelayedTrigger 存在
 *     （契约 3.6），但指令注册表没有 trigger.delayed（同 ogn-221-298 Imperial Decree、
 *     ogn-289-298 Targon's Peak）；把延迟能力写成卡自身触发的被动能力会违反 391.1/393。
 * (3) Recall 不可执行：已合入的 effect.move 明确把 Recall 标为 BLOCKED（CR 457-460），
 *     调用 mode: "recall" 返回 negated/impossible 且给出 blockedReason，不得用 move-location
 *     近似（458）。
 *   另记：交回控制权的语义依赖控制效果的到期/还原身份（479.2.a、482.3 的 timestamp 还原），
 *   已合入的 effect.control 明确说明 take-control 没有 duration/控制效果身份、非永久期限均 blocked；
 *   本文件把该半段写成对收据 owner 的第二次 take-control，仅为可审查的描述，不作为执行主张。
 *   "Take control ... / Ready it." 两段本身只用已合入原语，golden 用真实原语执行（含控制权实际
 *   变更、横置单位被重置、以及延迟半段被明确阻断的守卫）。
 * 依赖：cost.hidden + continuous.timing（RIFT-89/RIFT-91）、trigger.delayed 原语（RIFT-9）、
 * Recall 独立动作（RIFT-109 后续）。
 */
const hostileTakeover = {
  canonicalCardId: "card.hash-62970334aded475305f68e3c9c4e769ce6ebe07ff91a0030017c68594309466e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) [Hidden]（811）无可执行路径——keywords/Hidden.ts 的展开依赖 cost.hidden 的 Hide 行动、" +
    "facedown 区域限制与从 facedown 免费打出（RIFT-89），以及 continuous.timing 的后续 Reaction 时机许可（RIFT-91）；" +
    "(2) 「Lose control of that unit and recall it at end of turn」按 391.2/392/393 是该咒语创建的 Delayed Ability" +
    "（359.3.e.16 的示例正是本卡），ResolveContext.registerDelayedTrigger 虽在契约 3.6 中，但指令注册表没有" +
    "卡牌可用的 trigger.delayed op（同 ogn-221-298 Imperial Decree / ogn-289-298 Targon's Peak），" +
    "写成卡自身触发会违反 391.1/393；(3) Recall（457-460：不是 Move、不触发 Move 能力、不受移动限制、保留伤害与状态）" +
    "被已合入的 effect.move 明确标注 BLOCKED，mode: \"recall\" 返回 negated/impossible 并给出 blockedReason，" +
    "不得用 move-location 近似（458）。另：交回控制权需要控制效果的到期/还原身份（479.2.a、482.3），" +
    "已合入的 effect.control 明确说明 take-control 没有 duration/控制效果身份、非永久期限一律 blocked，" +
    "本文件里对该半段写的第二次 take-control 仅为可审查描述。" +
    "「Take control ... / Ready it.」两段只用已合入原语并有执行测试。" +
    "依赖：cost.hidden + continuous.timing（RIFT-89/RIFT-91）、trigger.delayed 原语（RIFT-9）、Recall 独立动作（RIFT-109 后续）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    {
      kind: "play",
      body: [
        {
          // "Take control of an enemy unit at a battlefield"：目标是该敌方单位
          // （355.9.b）；"at a battlefield" 是 location 限制（355.10.b）。控制变更走
          // 已合入的 take-control（契约 3.6）。
          id: "hostile-takeover.take-control",
          op: "effect.control",
          args: {
            objects: { kind: "constant", value: { target: "hostile-takeover.unit" } },
            linkKey: { kind: "constant", value: "controlled" }
          },
          targets: [
            {
              id: "hostile-takeover.unit",
              filter: { type: "unit", controller: "opponent", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Ready it."：同一个目标单位（契约 3.6 的 { target } 选择器）。不与控制
          // 指令 linkedTo —— 359.3.e.14.b 的 Ride the Wind 示例：前一句被 negated 时
          // 后一句仍按 359.3.e.11 尽可能执行。
          id: "hostile-takeover.ready",
          op: "effect.ready",
          args: {
            objects: {
              kind: "constant",
              value: { kind: "target", id: "hostile-takeover.unit" }
            },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "readied" }
          }
        },
        {
          // "Lose control of that unit and recall it at end of turn."：待落地的延迟
          // 触发注册（RIFT-9 trigger.delayed；见 judgeReason）。body 里的两条指令是
          // 交回控制权（读 take-control 收据的 owner）与 Recall（457-460）。
          id: "hostile-takeover.delayed-revert",
          op: "trigger.delayed",
          args: {
            at: { kind: "constant", value: "turn-end" },
            window: { kind: "constant", value: "this-turn" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "hostile-takeover.lose-control",
                  op: "effect.control",
                  args: {
                    // "that unit"：同一个 TargetSpec 的符号选择器。契约 3.6 允许
                    // { linked } 表达 "it"，但 effect.control / effect.move 的已合入选择符
                    // 只接受 source/target/pick/choose，因此与 Possession 一致地读回该目标。
                    objects: {
                      kind: "constant",
                      value: { target: "hostile-takeover.unit" }
                    },
                    player: {
                      kind: "object-property",
                      object: { linked: "hostile-takeover.take-control" },
                      property: "owner"
                    },
                    linkKey: { kind: "constant", value: "reverted" }
                  }
                },
                {
                  id: "hostile-takeover.recall",
                  op: "effect.move",
                  linkedTo: "hostile-takeover.lose-control",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { target: "hostile-takeover.unit" }
                    },
                    to: { kind: "constant", value: "controller-base" },
                    mode: { kind: "constant", value: "recall" }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "Take control of an enemy unit at a battlefield. Ready it. " +
    "(Start a combat if other enemies are there. Otherwise, conquer.)\n" +
    "Lose control of that unit and recall it at end of turn. " +
    "(Send it to base. This isn't a move.)"
} satisfies CardProgram;

export default hostileTakeover;
