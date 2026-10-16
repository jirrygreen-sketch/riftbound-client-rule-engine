import type { CardProgram } from "../../ir/index.js";

/**
 * Mirror Image (unl-200-219) — Spell, 3 energy + 2 power, Mind/Order,
 * tags LeBlanc / Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-200-219，逐字）：
 *   "Choose a unit. Play a ready Reflection unit token to your base. It becomes a copy of that unit. "
 *   "Give it [Temporary]. (Kill it at the start of its controller's Beginning Phase, before scoring.)"
 *
 * 规则依据（CR v1.5）：
 * - "Choose a unit"：具体对象选择（355.5）。355.10 的示例（"Choose a friendly unit. The next
 *   time it would die this turn …"）说明 "Choose a … unit" 是目标；因此选中的单位是 TargetSpec，
 *   不是 pick。
 * - "Play a ready Reflection unit token to your base"：Reflection 是 187.6 定义的 0 Might
 *   无域单位 token，effinal.token 的冻结定义表里有 "reflection"；"play" 按 440.2.c / 185.2.a
 *   先在链上生成再由打出流程接手，"to your base" 是目的地（355.2.a 的默认合法地点之一），
 *   "ready" 是 184.1 的入场状态改写（相对 143.4 的横置入场）。
 * - "It becomes a copy of that unit"：复制效果属 446.1 / 446.2 的 Copy 图层，按 479.1.a/b
 *   把被复制对象的可复制特征写到该 token 上；"that unit" 是前面的目标（359.3.f.1 的 referent）。
 * - "Give it [Temporary]"：816 的空格式关键词授予；816.1.b 的等价文本是"在该永久物控制者的
 *   Beginning Phase 开始时、计分前消灭它"，括号里的 reminder 只是释义，不是独立指令。
 *
 * status = judge-required（不近似实现）：
 * 1. "It becomes a copy of that unit" 没有可执行的复制路径：已合入的 effect.copy 的 mode
 *    "effect" 明确被阻断（blockedReason: copy-layer-traits-exceptions-and-attachment-duration-unavailable，
 *    446 / 479.1.a-d），它只能以 mode "create" 生成新对象；用新建对象冒充"token 变成复制体"
 *    会得到错误的图层与身份（479.1.b.1）。
 * 2. "Give it [Temporary]" 需要关键词授予与 Temporary 的展开：effects/keywords/ 的 16 个
 *    已合入关键词不含 Temporary（与 ogn/sprite、rad/momentary-companion 同缺口），
 *    continuous.grant-keyword 也没有已注册原语（依赖 RIFT-91 与 Temporary 关键词任务）。
 * 3. "ready" 是入场状态改写（143.4 / 184.1 / 185.2.d）：create-token 不支持入场状态，
 *    先创建再补一次 ready 会产生错误的"成为就绪"事件，也可能错过入场替代（143.4.a）。
 * 4. "It becomes a copy" 的 referent "it" 需要"本次结算新创建的 token"这一链接对象：
 *    effect.token 的回执提供 token.objects（可直接读），但把它接进 copy 的 onto 需要
 *    第 1 点的复制图层。
 *
 * 可执行部分：effect.token 的 play 路径对定义表内的 "reflection" 已合入，golden 用参考
 * 内核真实执行并断言新 token 的身份（0 Might / 无域 / Reflection 名称）；整卡不可执行。
 */

export default {
  canonicalCardId: "card.hash-1624e5bc418da476f531d04662765fc6e20f06c4b970aa940a696af64789318b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处依赖未合入，均不近似实现：(1) “It becomes a copy of that unit” 是 446.1 / 446.2 的 Copy 图层（479.1.a–d），" +
    "已合入的 effect.copy 的 mode \"effect\" 被显式阻断（blockedReason: copy-layer-traits-exceptions-and-attachment-duration-unavailable），" +
    "用 mode \"create\" 新建对象冒充“token 变成复制体”会得到错误的图层与身份（479.1.b.1）。" +
    "(2) “Give it [Temporary]” 需要关键词授予与 816 的 Temporary 展开：effects/keywords 的 16 个已合入关键词不含 Temporary，" +
    "continuous.grant-keyword 也没有已注册原语（与 ogn/sprite、rad/momentary-companion 同缺口，依赖 RIFT-91 与 Temporary 关键词任务）。" +
    "(3) “Play a ready Reflection unit token” 的 “ready” 是入场状态改写（143.4 / 184.1 / 185.2.d）：create-token 不支持入场状态，" +
    "先创建再补一次 ready 会产生错误的“成为就绪”事件并可能错过 143.4.a 的入场替代。" +
    "(4) 第 3 条结论同时意味着参考内核对入场状态不建模，golden 只断言 token 的身份与位置，不把“ready”当作已验证。[Action]/[Reaction] 均未印刷。" +
    "已合入部分：effect.token 的 play 路径对定义表内的 \"reflection\"（187.6 的 0 Might 无域单位 token）可执行，golden 用参考内核真实执行。",
  abilities: [
    {
      kind: "play",
      body: [
        {
          // “Play a ready Reflection unit token to your base.”（440.2.c /
          // 185.2.a 的链上创建 + 打出；187.6 的 token 定义；355.2.a 的目的地）
          id: "mirror-image.play-reflection",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "reflection" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            linkKey: { kind: "constant", value: "reflectionToken" }
            // “ready” 的入场状态改写（184.1）尚无 create-token 支持，见 judgeReason
            // 第 3 点；不新增 IR 参数键、也不会先创建再补一次横置/就绪的效应。
          }
        },
        {
          // “It becomes a copy of that unit.” Copy 图层被阻断（446 / 479.1），
          // 这里保留完整的选定形状：来源是前面选中的单位（target 选择器），
          // 作用于本次创建的 token（token 回执的引用），依赖见 judgeReason 第 1 点。
          id: "mirror-image.copy-unit",
          op: "effect.copy",
          linkedTo: "mirror-image.play-reflection",
          args: {
            source: { kind: "constant", value: { target: "mirror-image.unit" } },
            mode: { kind: "constant", value: "effect" },
            // 契约 3.6 的 ObjectSelector 只有 self/source/target/pick/linked，其中
            // {linked: id} 引用前序指令产出的对象；effect.copy 的 onto 要求符号
            // 选择器（不是 linked-value 表达式，因为 token 回执的
            // "reflectionToken.objects" 不是指令 id）。
            onto: {
              kind: "constant",
              value: { linked: "mirror-image.play-reflection" }
            },
            duration: { kind: "constant", value: "permanent" }
          },
          targets: [
            {
              id: "mirror-image.unit",
              // 355.5 / 355.10："Choose a unit" 是目标（该单位被指定为受影响对象）。
              filter: { type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // “Give it [Temporary]” 是 816 的空格式关键词授予；Temporary 的展开与
          // continuous.grant-keyword 消费方见 judgeReason 第 2 点。
          id: "mirror-image.grant-temporary",
          op: "continuous.grant-keyword",
          linkedTo: "mirror-image.copy-unit",
          args: {
            keyword: { kind: "constant", value: "Temporary" },
            duration: { kind: "constant", value: "permanent" },
            // 同一个符号选择器形状（前序指令产出的对象）；授予的消费方见
            // judgeReason 第 2 点。
            objects: {
              kind: "constant",
              value: { linked: "mirror-image.play-reflection" }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "Choose a unit. Play a ready Reflection unit token to your base. It becomes a copy of that unit. " +
    "Give it [Temporary]. (Kill it at the start of its controller's Beginning Phase, before scoring.)"
} satisfies CardProgram;
