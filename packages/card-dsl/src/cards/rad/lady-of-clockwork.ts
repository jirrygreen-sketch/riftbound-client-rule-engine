import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lady of Clockwork (rad-145-167) — Legend, Calm/Mind, tag Orianna.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-145-167，逐字）：
 *   At the start of your Main Phase, you may pay :rb_energy_1: to choose a
 *   friendly gear. It becomes a unit gear with Might equal to its Energy cost
 *   until you choose another gear with me.
 *
 * 规则依据（CR v1.5）：
 * - 383.1：“At the start of your Main Phase” 是触发条件；封闭时点表用 main-start
 *   （316.1 Main Phase begins、316.4 “At the start of Main Phase game effects take
 *   place”）。190.6.d：未特别指明玩家的指令里隐含的 “you” 是来源控制者。
 * - 383.3.a：“you may” 位于效果开头，是 Finalize 时决定是否执行该触发的许可。
 *   契约 3.9（2026-10-16 冻结）要求把被选指令包进 choice.optional 的 body，
 *   不写成 “choice + 后续指令 linkedTo”。
 * - 204.3 / 383.3.b：“pay :rb_energy_1:” 在冒号之前、紧随 “you may”，是能力费用
 *   （“费用在使用该能力时支付”），不是结算时的游戏动作；用 cost.pay 保留该边界。
 * - 355.7 / 355.10：“choose a friendly gear” 明确选定一个具体对象，因此是目标
 *   （对照 355.10.b 的 restrict-only 例外与 355.10.g 对传奇的例外），用 TargetSpec
 *   声明：controller 为能力控制者、type 为 gear。
 * - 206：“effects that need to determine a card or token’s cost for any purpose always
 *   use its printed—or if a copy effect is applied, copied—cost”，所以 “Might equal to
 *   its Energy cost” 读的是印刷 Energy 值，用 object-property 表达式在结算时从该目标
 *   读取（契约 3.6 的 evaluate 时机；energy:null 表示无印刷值，绝不转成 0）。
 * - “becomes a unit gear” 是特征改写（133.4.a.2 的 Unit / Gear 类型、150.4 的
 *   Equipment 规则），由 trait 图层处理（契约 3.4 的图层顺序 copy → trait → ability
 *   → arithmetic）；“until you choose another gear with me” 是与该传奇的选择绑定的
 *   持续期，不是现有 Duration 里的 end-of-turn / end-of-combat / while-source-in-zone。
 *
 * status = judge-required（逐个缺口写出证据，不近似实现）：
 * 1. 缺可执行的费用步骤：cost.pay 没有原语实现（effects/instructions/ 里没有
 *    cost.pay 文件，解释器直接抛 “Unregistered instruction opcode: cost.pay”），
 *    触发能力的基础费用（404.1.b.1 / 383.3.b）也没有接线到 IR——费用种类与
 *    cost.pay / cost.modify 属 RIFT-261。把 1 Energy 写成 effect.resources 会把
 *    Finalize 的费用变成结算效果。
 * 2. “It becomes a unit gear” 需要 trait 层的即时特征改写（拿到 unit 类型）与
 *    Might “设值”，并且要在图层内按 206 读取该装备印刷的 Energy 值。已合入的
 *    continuous.might 只做 Might 的 add/set，不携带 addTypes 这类 trait 改写
 *    （argsSchema 拒绝 addTypes: “Invalid continuous.might argument”）；Snapshot 类型
 *    改动需要单独的 trait 图层入口，卡牌 static → 图层的注册方也不存在（RIFT-257）。
 * 3. 持续期 “until you choose another gear with me” 需要与来源绑定的“直到下一次选择”
 *    状态与到期清理：layers 的 Duration 只有 permanent / end-of-turn / end-of-combat /
 *    while-source-in-zone / until（某个时点），没有“再选一次”这种由后续选择触发的
 *    到期；同时要保留“用我选择”的来源关联（135.4.b / 801.3.a 的同类边界）。
 * 依赖 RIFT-261（费用/支付）与 RIFT-257（卡程序绑定）以及持续时间模型的扩展。
 * golden 真实执行已合入的部分：choice.optional 的拒绝分支（不支付、不改写）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "main-start",
      // 316.1 / 316.4：“your Main Phase” 是来源控制者的 Main Phase 开始；
      // 190.6.d：未指明玩家的 “you” 指能力控制者。
      filter: { event: "main-start", player: "self" }
    },
    // 383.3.a 的 “you may” 在效果开头：触发本身保持非可选（由 Finalize 把整条触发
    // 放上链），选择通过下面的 choice.optional 表达（契约 3.9 的冻结形状）。
    optional: false,
    body: [
      {
        id: "lady-of-clockwork.opt-in",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Pay 1 energy to choose a friendly gear?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "lady-of-clockwork.pay",
                // 204.3 / 383.3.b：这是能力费用（在 Finalize 支付），不是结算效果；
                // cost.pay 没有原语实现（见 judgeReason 第 1 点）。
                op: "cost.pay",
                args: { energy: { kind: "constant", value: 1 } }
              },
              {
                id: "lady-of-clockwork.become-unit-gear",
                // trait 层的特征改写 + arithmetic 层的 Might 设值：拿到 unit 类型，
                // 并把 Might 设为该目标印刷的 Energy 值（206，结算时求值）。
                op: "continuous.might",
                linkedTo: "lady-of-clockwork.pay",
                args: {
                  amount: {
                    kind: "object-property",
                    object: { target: "lady-of-clockwork.gear" },
                    property: "energy"
                  },
                  mode: { kind: "constant", value: "set" },
                  addTypes: { kind: "constant", value: ["unit"] },
                  duration: { kind: "constant", value: "until-you-choose-another-gear-with-me" },
                  objects: {
                    kind: "constant",
                    value: { kind: "target", id: "lady-of-clockwork.gear" }
                  }
                },
                targets: [
                  {
                    id: "lady-of-clockwork.gear",
                    // “a friendly gear”：能力控制者拥有的 Gear（355.9.b / 355.10）。
                    filter: { zone: "board", type: "gear", controller: "controller" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-3cd6936ca27659594b605ddc164b8a803fc72df73ac4a16f33b673ecabc1791a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处未合入依赖：(1) 缺可执行的费用步骤：「you may pay :rb_energy_1:」在 204.3 / 383.3.b 下是触发能力的基础费用，" +
    "但 cost.pay 没有原语实现、触发能力的基础费用也没有接线到 IR——费用种类与 cost.pay / cost.modify 属 RIFT-261；" +
    "把它写成结算时的 effect.resources 会把费用变成效果。" +
    "(2)「It becomes a unit gear with Might equal to its Energy cost」需要 trait 层的类型改写（拿到 unit 类型）与 Might 设值，" +
    "并在图层内按 206 读取该装备印刷的 Energy 值；已合入的 continuous.might 只做 Might 的 add/set、不携带 addTypes（argsSchema 拒绝），" +
    "卡牌 static → 图层的绑定方也不存在（RIFT-257）。" +
    "(3) 持续期「until you choose another gear with me」需要与来源绑定的“直到下一次选择”到期状态：layers 的 Duration 只有 " +
    "permanent / end-of-turn / end-of-combat / while-source-in-zone / until（某个时点），没有由后续选择触发的到期模型" +
    "（135.4.b / 801.3.a 的同类边界）。golden 真实执行的是 choice.optional 的拒绝分支（不支付、不改写）。不近似实现。",
  abilities,
  sourceText:
    "At the start of your Main Phase, you may pay :rb_energy_1: to choose a friendly gear. " +
    "It becomes a unit gear with Might equal to its Energy cost until you choose another gear with me."
} satisfies CardProgram;

export default program;
