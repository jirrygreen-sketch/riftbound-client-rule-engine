import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Frisky Hunter (unl-033-219) — Unit, 4 Energy, Might 3, Calm, tags Cat/Zaun.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-033-219，逐字）：
 *   When you play me, play a 1 :rb_might: Bird unit token with [Deflect] here.
 *   (Opponents must pay :rb_rune_rainbow: to choose it with a spell or ability.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1 与 420.4.a：“When you play me” 是 Play Effect，在打出完成后
 *   进链；时点用封闭表的 card-played，filter 以契约 3.6 的符号选择器指向来源自身。
 * - “play a 1 [M] Bird unit token”：187.7 定义 1 Might Bird token（域外单位 token、
 *   1 Might、Bird 标签、带 [Deflect]）；440.2.c / 185.2.a 规定被“打出”的 token 先在
 *   链上生成再交给 play 动作，因此 effect.token 的 mode 为 "play"（185.3.a：token 的
 *   费用是 null，不是 0）。
 * - “with [Deflect]”：809.1 / 809.1.b.3 / 809.1.c.1 的被动关键词属于 token 定义本身，
 *   不是本卡的授予指令；括号内是提醒文本（135.2.d.3 无游戏功能），本文件不重复实现。
 * - “here” = 打出本单位的那个位置（420.3.b 的 here referent；464.2.b 的后续引用重新
 *   指向该位置），静态 IR 里只能用契约 3.6 的 object-property + "source" 选择器表达。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 缺 Bird token 定义：已合入的 effect.token 只在冻结定义表（recruit / sand-soldier /
 *   mech / reflection / tentacle —— 都刻意是没有额外能力的定义）里解析 token id，
 *   187.7 的 Bird 带 [Deflect]，因此该指令没有可解析的定义，程序不能声称整卡可执行。
 * - “here” 的形状不一致（README 第 3 节的“类型/校验器尚未同步契约”情形）：卡程序用契约
 *   3.6 的符号选择器，而已合入 effect.token.argsSchema 的 isExpr 仍要求 object-property
 *   的 object 是运行时 ObjectRef，符号选择器会被拒绝（与 rad/industrious-mechsmith、
 *   sfd/treasure-hoard 记录同一 IR 层缺口，依赖 RIFT-62 / RIFT-1）。
 * - token 上的 [Deflect]（809.1.c.1 的“可选任意域力量支付”追加费）还依赖目标税接线
 *   （RIFT-90）。
 * 依赖：effect.token 的定义表扩展（187.7）、RIFT-62（argsSchema 与契约同步）、
 * RIFT-90（Deflect 目标税消费方）。不近似实现：不用别的 token 顶替 Bird，不硬编码位置。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "frisky-hunter.play-bird",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "bird" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          // “here”：契约 3.6 的符号选择器形状；effect.token.argsSchema 尚未同步（见 status）。
          location: {
            kind: "object-property",
            object: "source",
            property: "location"
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
    "因此 “play a 1 :rb_might: Bird unit token” 没有可解析的定义（440.2.c / 185.2.a 的链上创建 + 打出交接本身已合入）。" +
    "其次，“here” 只能用契约 3.6 的 ObjectSelector（object-property + \"source\"）表达，" +
    "但 effect.token.argsSchema 的 isExpr 仍要求运行时 ObjectRef，符号选择器被直接拒绝（README 第 3 节的校验器未同步，" +
    "与 rad/industrious-mechsmith、sfd/treasure-hoard 同一缺口）。" +
    "token 上 [Deflect]（809.1.c.1 的追加费可用任意域力量支付）也还缺目标税消费方。" +
    "依赖：effect.token 定义表扩展（187.7）、RIFT-62（argsSchema 同步）、RIFT-90（Deflect 目标税）。不近似实现。",
  abilities,
  sourceText:
    "When you play me, play a 1 :rb_might: Bird unit token with [Deflect] here. " +
    "(Opponents must pay :rb_rune_rainbow: to choose it with a spell or ability.)"
} satisfies CardProgram;

export default program;
