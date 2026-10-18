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
 * status 判定（cards/README.md 第 2 节）：judge-required（2026-10-17 复核后缺口更新如下）。
 * - 缺 Sprite token 定义（未变）：已合入的 effect.token 只在冻结定义表（recruit / sand-soldier /
 *   mech / reflection / tentacle —— 都刻意不带额外能力）里解析 token id，187.2 的 Sprite 带
 *   [Temporary]，因此 “play a ready 3 [M] Sprite unit token” 没有可解析的定义（复核实测该指令对
 *   sprite 返回 negated + blockedReason "token-definition-or-abilities-judge-required"，
 *   不用别的 token 顶替）。
 * - “ready” 的入场状态改写不受支持（未变）：create-token / play 动作明确不支持 entry override，
 *   复核实测 effect.token 的 schema 直接拒绝 ready 一类参数键（"Invalid effect.token argument"）。
 * - [Temporary] 的 KeywordDef 已合入，expandProgram 与 lifecycle binder 能处理显式传入的
 *   CardProgram；但其展开挂的是 beginning-start 触发，而该事件名不在 EventPattern 的封闭词表
 *   （EVENT_PATTERN_TYPES）里，注册会被 invalid-event-type 拒绝，所以 token 生命周期绑定
 *   与默认房间的程序注入仍缺。
 * - [Shield] 的 KeywordDef 与 static binder 已合入，designation 事实也已由
 *   ObjectSnapshot.combatRole + expr-ext 求值器提供；但默认条件/图层分派仍不接 expr-ext
 *   （condition.ts 的 evaluateCondition 只走 evaluateExpression，statics.ts 把条件异常吞成
 *   false），未知 designation 在默认路径上 fail-closed 为 false。
 * - hold 侧：turn/flow.ts 的 Score wave 已发出 hold/held，programs/triggers.ts + filters.ts
 *   能把本卡的 held 订阅翻译成 { event: "held", object: { objectId: <self> } } 并注册进真实
 *   管线并通过封闭 TriggerSpec 校验；但 hold 事件载荷只带 battlefield/player、没有对象，
 *   objectId 绑定的订阅实测永不匹配（golden：hold 事件与点数发生、链为空），
 *   仍没有「固守当场在场的那个单位」的绑定，383.4.d.2 的限定无法核对。
 * 依赖：effect.token 定义表扩展（187.2）与入场状态改写、token 的 beginning-start 触发词表接线、
 * hold 载荷的单位绑定、默认路径的 designation（expr-ext）求值，以及默认房间的程序注入。
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
        id: "trevor-snoozebottom.read-here",
        op: "condition.value",
        args: {
          value: { kind: "object-property", object: "source", property: "location" },
          key: { kind: "constant", value: "here" }
        }
      },
      {
        id: "trevor-snoozebottom.play-sprite",
        op: "effect.token",
        linkedTo: "trevor-snoozebottom.read-here",
        args: {
          // 187.2：3 [M] Sprite unit token（域外、Fae、带 [Temporary]）。
          token: { kind: "constant", value: "sprite" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：被“打出”的 token 先在链上创建，再交给 play 动作。
          mode: { kind: "constant", value: "play" },
          // “here” = 来源所在位置，先由 condition.value 读取再链接到 token。
          location: {
            kind: "linked-value",
            instructionId: "trevor-snoozebottom.read-here",
            key: "here"
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
    "当前缺口（CR v1.5，2026-10-17 实测），均不近似实现：(1) 缺 187.2 的 3 [M] Sprite unit token 定义——它是域外单位 token、" +
    "3 Might、Fae 标签、带 [Temporary]，而已合入 effect.token 的冻结定义表只含没有额外能力的 " +
    "recruit/sand-soldier/mech/reflection/tentacle，复核实测该指令对 sprite 返回 negated 与 " +
    "blockedReason \"token-definition-or-abilities-judge-required\"（440.2.c/185.2.a 的链上创建 + 打出交接本身已合入）。" +
    "(2) “ready” 是入场状态改写（143.4 / 184.1 / 185.2.d），create-token/play 动作明确不支持 entry override，" +
    "复核实测 effect.token 的 schema 直接以 \"Invalid effect.token argument: ready\" 拒绝该参数键；" +
    "先创建再补一次 effect.ready 会产生多余的“成为就绪”事件。(3) token 上的 [Temporary]（816.1.b 的" +
    "“在控制者 Beginning Phase 开始、计分前 kill this”，816.2.a 多实例冗余）的 KeywordDef 已合入，" +
    "expandProgram 与 lifecycle binder 也已能展开并注册显式传入的 CardProgram；但其展开的触发时点是 beginning-start，" +
    "该事件名不在 EventPattern 的封闭词表 EVENT_PATTERN_TYPES 内，注册被 invalid-event-type 拒绝，" +
    "token 生命周期绑定与默认房间注入本卡程序仍缺。" +
    "(4) hold 触发缺少「本卡是在固守的战场上在场的那个单位」的载荷绑定（383.4.d.2/.2.a；hold 现由 turn/flow.ts 的 Score wave 发出，" +
    "programs/filters.ts 也能把本卡的 held filter 翻成 objectId 绑定并通过 TriggerSpec 校验，" +
    "但 hold 事件载荷只带 battlefield/player、没有对象，golden 实测订阅永不匹配：点数与 hold 事件都发生、链却为空，" +
    "Hold Ability 无法成为 Pending Item）。" +
    "另外 [Shield]（814.1.b.3 省略值按 1）的 KeywordDef 与 static binder 已合入，designation 事实也已由 " +
    "ObjectSnapshot.combatRole + effects/interpreter/expr-ext/evaluate.ts 提供，但默认条件/图层分派仍不接 expr-ext " +
    "（condition.ts 的 evaluateCondition 只走 evaluateExpression、programs/statics.ts 把条件异常吞成 false），" +
    "因此 814.1.d.1 的 +1 在默认路径上不能生效。依赖：effect.token 定义表扩展与入场状态改写、" +
    "beginning-start 触发词表接线、hold 载荷的单位绑定、默认路径的 designation（expr-ext）求值，以及默认房间的程序注入。",
  abilities,
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "When I hold, play a ready 3 :rb_might: Sprite unit token with [Temporary] here. " +
    "(Kill it at the start of its controller's next Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default program;
