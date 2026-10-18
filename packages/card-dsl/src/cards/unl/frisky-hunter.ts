import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Frisky Hunter (unl-033-219) — Unit, 4 Energy, Might 3, Calm, tags Cat/Zaun.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-033-219，逐字）：
 *   When you play me, play a 1 :rb_might: Bird unit token with [Deflect] here.
 *   (Opponents must pay :rb_rune_rainbow: to choose it with a spell or ability.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1 与 420.4.a："When you play me" 是 Play Effect，在打出完成后
 *   进链；时点用封闭表的 card-played，filter 以契约 3.6 的符号选择器指向来源自身。
 * - "play a 1 [M] Bird unit token"：187.7 定义 1 Might Bird token（域外单位 token、
 *   1 Might、Bird 标签、带 [Deflect]）；440.2.c / 185.2.a 规定被"打出"的 token 先在
 *   链上生成再交给 play 动作，因此 effect.token 的 mode 为 "play"（185.3.a：token 的
 *   费用是 null，不是 0）。
 * - "with [Deflect]"：809.1 / 809.1.b.3 / 809.1.c.1 的被动关键词属于 token 定义本身，
 *   不是本卡的授予指令；括号内是提醒文本（135.2.d.3 无游戏功能），本文件不重复实现。
 * - "here"（359.3.f.1）：referents 从能力来源读取，在指令执行时检查。静态 IR 不能写
 *   运行时 ObjectRef，所以用已合入的 condition.value 原生指令在结算期读出
 *   来源当前位置，再由 effect.token 的 location 经 linked-value 读取
 *   （359.3.f.2 的执行时机）。生产先例：sfd/corinna-veraza 同型绑定 token 位置。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 缺 Bird token 定义：已合入的 effect.token 只在冻结定义表（recruit / sand-soldier /
 *   mech / reflection / tentacle —— 都刻意是没有额外能力的定义）里解析 token id，
 *   187.7 的 Bird 带 [Deflect]，因此该指令没有可解析的定义，原语返回
 *   blockedReason "token-definition-or-abilities-judge-required"；金测试用 Bird
 *   形状记录被拒回执，并用已合入的 mech 定义证明同一指令形状真的执行
 *   （创建 + 打出交接、位置绑定）。
 * - "here" 的符号绑定已可执行：condition.value 在结算期读出来源位置，
 *   effect.token 的 linked-value location 同型（corinna-veraza）真实执行。
 * - token 上的 [Deflect]（809.1.c.1 的"可选任意域力量支付"追加费）依赖目标税消费方：
 *   Deflect 税的派生与换算已合入（target/tax/collect.ts 的 deflectAmount /
 *   deflectCost 按任意域 Power 计费），但链引擎的生产路径仍把目标税当作 Energy
 *   附加费（chain/engine.ts 的 mandatoryAdditional 记账），taxAdapter 也还没有
 *   已合并的生产调用方（RIFT-90 后续）。
 *
 * 依赖：effect.token 的定义表扩展（187.7）、RIFT-90（Deflect 目标税的生产接线）。
 * 不近似实现：不用别的 token 顶替 Bird，不硬编码位置。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        // 359.3.f.1: "here" referents read from the ability source at
        // execution time; the merged condition.value instruction binds the
        // location as a linked value for effect.token (359.3.f.2).
        id: "frisky-hunter.bind-location",
        op: "condition.value",
        args: {
          value: {
            kind: "object-property",
            object: "source",
            property: "location"
          },
          key: { kind: "constant", value: "location" }
        }
      },
      {
        id: "frisky-hunter.play-bird",
        op: "effect.token",
        linkedTo: "frisky-hunter.bind-location",
        args: {
          token: { kind: "constant", value: "bird" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          // "here": read by condition.value above and consumed as a
          // linked-value location (sfd/corinna-veraza precedent).
          location: {
            kind: "linked-value",
            instructionId: "frisky-hunter.bind-location",
            key: "location"
          },
          linkKey: { kind: "constant", value: "bird" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-3a7cc51beec4c03c4ab2831bc17b65610301b0eacb31ebfd269232c29dea5258",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 187.7 的 1 [M] Bird unit token 定义：该 token 是域外单位 token、带 Bird 标签与 [Deflect]，" +
    "而已合入 effect.token 的冻结定义表只含没有额外能力的 recruit / sand-soldier / mech / reflection / tentacle，" +
    "原语因此返回 blockedReason \"token-definition-or-abilities-judge-required\"，没有可执行的创建路径" +
    "（440.2.c / 185.2.a 的链上创建 + 打出交接本身已合入）。" +
    "\"here\" 的符号绑定已可执行：condition.value 在结算期读出来源位置（359.3.f.1），" +
    "effect.token 的 linked-value location 消费同型（sfd/corinna-veraza 先例），金测试真实执行。" +
    "token 上 [Deflect]（809.1.c.1 的追加费可用任意域力量支付）的生产接线仍缺：" +
    "Deflect 税的派生与换算已合入（target/tax/collect.ts 的 deflectAmount/deflectCost 按任意域 Power 计费），" +
    "但链引擎生产路径仍把目标税按 Energy 附加费记账（chain/engine.ts 的 mandatoryAdditional），" +
    "taxAdapter 也没有已合并的生产调用方（RIFT-90 后续）。" +
    "依赖：effect.token 定义表扩展（187.7）、RIFT-90。不近似实现。",
  abilities,
  sourceText:
    "When you play me, play a 1 :rb_might: Bird unit token with [Deflect] here. " +
    "(Opponents must pay :rb_rune_rainbow: to choose it with a spell or ability.)"
} satisfies CardProgram;

export default program;
