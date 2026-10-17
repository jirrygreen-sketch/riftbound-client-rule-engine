import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Trevor Snoozebottom (unl-048-219) — Unit, 3 Energy, Might 3, Calm, tags Yordle/Ionia.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-048-219，逐字）：
 *   [Shield] (+1 :rb_might: while I'm a defender.)
 *   When I hold, play a ready 3 :rb_might: Sprite unit token with [Temporary] here.
 *   (Kill it at the start of its controller's next Beginning Phase, before scoring.)
 *
 * 规则依据（CR v1.5）：
 * - [Shield]：814.1 的 Passive Ability 关键词；814.1.a 出现在单位上；814.1.b / 814.1.b.1 / .b.2
 *   的印刷形式是 "Shield [X]"，本卡省略 X，按 814.1.b.3 视为 1；814.1.c 功能上等于「当我是防守方时
 *   +1 [M]」；814.1.d / 814.1.d.1 说明防守方身份在 Combat 中取得、只在维持该身份期间生效；
 *   814.2 多来源求和；814.3 是可读取特征。按契约 3.7 / README 第 5 节，卡文件只声明
 *   `{ kind: "keyword", keyword: "shield" }`，展开由 effects/keywords/Shield.ts 负责。
 * - “When I hold”：383.4.d 的 Hold Effect（383.4.d.1 的 “When I hold…” 写法；383.4.d.2 限定此类
 *   触发只属于固守时在场的那个单位，383.4.d.2.a 说明它作为 Pending Item 进链）；hold 时点由 Score wave
 *   发出（ruleRefs 315.2.b.2 / 471.2 / 473.2.b），触发过滤用封闭 EVENT_PATTERN_TYPES 里的 "held"
 *   （383.4.d.2.a；同 shen-scourge-of-shadows 的记录），filter 以内层 source: "self" 指称本卡。
 * - “play a ready 3 [M] Sprite unit token with [Temporary] here”：187.2 定义 3 [M] Sprite token——
 *   域外单位 token、3 Might、Fae 标签、带 Temporary 关键词；440.2.c / 185.2.a 规定被“打出”的 token
 *   先在链上生成再交给 play 动作，因此 effect.token 用 mode "play"（185.3.a：token 没有印刷费用，
 *   不是 0）。“with [Temporary]” 是 token 自身的印刷关键词（187.2 / 816.1：在其控制者的 Beginning
 *   Phase 开始、计分之前消灭它），属于 token 定义，不是本卡的授予指令。
 * - “ready” 是入场状态：143.4 规定单位默认横置入场，184.1 允许创建 token 的效果声明“入场就绪”，
 *   185.2.d 说明 token 沿用其类型的入场规则——所以这是创建/打出动作的入场状态改写，不是事后的
 *   effect.ready（后者会多出一次“成为就绪”事件，见 effect.ready 自身的边界说明）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核后缺口更新如下）。
 * - 缺 Sprite token 定义（未变）：已合入的 effect.token 只在冻结定义表（recruit / sand-soldier /
 *   mech / reflection / tentacle —— 都刻意不带额外能力）里解析 token id，187.2 的 Sprite 带
 *   [Temporary]，因此 “play a ready 3 [M] Sprite unit token” 没有可解析的定义（复核实测该指令对
 *   sprite 返回 negated + blockedReason "token-definition-or-abilities-judge-required"，
 *   不用别的 token 顶替）。
 * - “ready” 的入场状态改写不受支持（未变）：create-token / play 动作明确不支持 entry override，
 *   先创建再补一次 effect.ready 会产生错误的“成为就绪”事件。
 * - [Temporary] 的 KeywordDef 已合入（RIFT-265），expandProgram 与 lifecycle binder 能处理显式
 *   传入的 CardProgram；但 expansion 的 beginning-start 过滤不在 EventPattern 词表，且默认房间
 *   不注入本卡程序，因此该 token 触发仍 fail-closed。
 * - [Shield] 的 KeywordDef 与 static binder 已合入（RIFT-81/RIFT-257），但 Defender designation
 *   仍不是当前 ObjectSnapshot 的可求值特征；未知 designation 会 fail-closed 为 false。
 * 依赖：effect.token 定义表扩展（187.2）与入场状态改写、beginning-start 事件词表/生产者、
 * RIFT-31/33 的 hold 载荷、designation 特征求值与默认房间的程序注入。
 * 不近似实现：不用其他 token 代替 Sprite，不用事后 effect.ready 冒充入场就绪，
 * 不把 [Shield] 写成无条件的数值加算。
 */
const abilities: Ability[] = [
  // 814.1.b.3：印刷省略 Shield Value，按 1 处理（默认值由 keywords/Shield.ts 承担）。
  { kind: "keyword", keyword: "shield" },
  {
    kind: "triggered",
    trigger: { at: "hold", filter: { event: "held", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "trevor-snoozebottom.play-sprite",
        op: "effect.token",
        args: {
          // 187.2：3 [M] Sprite unit token（域外、Fae、带 [Temporary]）。
          token: { kind: "constant", value: "sprite" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：被“打出”的 token 先在链上创建，再交给 play 动作。
          mode: { kind: "constant", value: "play" },
          // “here” = 来源所在位置（契约 3.6 的选择器形状；effect.token.argsSchema 尚未同步该形状，
          // 与 rad/industrious-mechsmith、sfd/treasure-hoard 记录同一 IR 层缺口）。
          location: {
            kind: "object-property",
            object: "source",
            property: "location"
          },
          linkKey: { kind: "constant", value: "sprite" }
          // 184.1 的 “ready” 入场状态改写与 token 上的 [Temporary]（187.2/816.1）都不新增 IR 参数键：
          // 它们属于 token 定义与创建/打出动作（见 judgeReason），不写进本指令。
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-2becbc4280283ab4687ffaf051fc67d926dcc7f221810d14f31c9181a9b5cd0e",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处缺口，均不近似实现：(1) 缺 187.2 的 3 [M] Sprite unit token 定义——它是域外单位 token、" +
    "3 Might、Fae 标签、带 [Temporary]，而已合入 effect.token 的冻结定义表只含没有额外能力的 " +
    "recruit/sand-soldier/mech/reflection/tentacle，复核实测该指令对 sprite 返回 negated 与 " +
    "blockedReason \"token-definition-or-abilities-judge-required\"（440.2.c/185.2.a 的链上创建 + 打出交接本身已合入）。" +
    "(2) “ready” 是入场状态改写（143.4 / 184.1 / 185.2.d），create-token/play 动作明确不支持 entry override，" +
    "先创建再补一次 effect.ready 会产生多余的“成为就绪”事件。(3) token 上的 [Temporary]（816.1.b 的" +
    "“在控制者 Beginning Phase 开始、计分前 kill this”，816.2.a 多实例冗余）的 KeywordDef 已合入（RIFT-265），" +
    "expandProgram 与 lifecycle binder 也已能展开并注册显式传入的 CardProgram；但展开使用的 beginning-start 事件名不在" +
    "events/trigger-spec.ts 的 EventPattern 词表内，导致该 token 关键词的触发注册仍 fail-closed，且默认房间不注入本卡程序。" +
    "(4) hold 触发缺少「本卡是在固守的战场上在场的那个单位」的载荷绑定（383.4.d.2/.2.a；hold 现由 turn/flow.ts 的 Score wave 发出，" +
    "但载荷只带战场/玩家）。另外 [Shield]（814.1.b.3 省略值按 1）的 KeywordDef 与 static binder 已合入（RIFT-81/RIFT-257），" +
    "但 814.1.d.1 的 Defender designation 门控依赖当前 ObjectSnapshot 未提供的 designation 特征；未知值会被求值器 fail-closed 为 false，" +
    "因此 +1 不能在成为 defender 时生效。依赖：effect.token 定义表扩展与入场状态改写、beginning-start 的事件词表/生产者、" +
    "RIFT-31/33（hold 载荷）、designation 特征求值，以及默认房间的程序注入。",
  abilities,
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "When I hold, play a ready 3 :rb_might: Sprite unit token with [Temporary] here. " +
    "(Kill it at the start of its controller's next Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default program;
