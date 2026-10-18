import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sprite Fountain (unl-078-219) — Gear, 2 energy + 1 Mind power、Might null，
 * 领域 Mind，无标签。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json unl-078-219，含换行）：
 *   "[Temporary] (Kill this at the start of its controller's Beginning Phase, before
 *   "scoring.)"
 *   "When you play this, play a ready 3 :rb_might: Sprite unit token with [Temporary]
 *   "to your base."
 *   "[Deathknell][>] Repeat this gear's play effect. (When this dies, get the effect.)"
 *
 * 规则依据（CR v1.5）：
 * - [Temporary]（816.1 / 816.1.a–c）：触发式能力关键词，功能等价于“在该永久物控制者的
 *   Beginning Phase 开始时、计分之前，消灭此牌”；816.2/816.2.a 冗余、816.3 是可读特征。
 *   按 cards/README.md 第 5 节只声明 keyword 能力，展开归关键词注册表
 *   （effects/keywords/Temporary.ts 已注册并按 816.1.b 展开 beginning-start
 *   消灭触发；其 body 在 golden 中经真实解释器执行）。
 * - "When you play this, …" 是 383.4.a / 383.4.a.1 的 Play Effect：触发条件包含“打出
 *   自身的永久物进场”，时点 card-played、filter 指向自身。383.4.a.4 的排除只针对
 *   “另一个对象被打出时触发”的能力，本卡被打出的就是自身。
 * - "[Deathknell][>] Repeat this gear's play effect."：808.1.b / 808.1.b.1 规定 [Effect]
 *   是该实例的规则文本；808.1.c.2 说明 [Effect] 用过去式时指触发进链那一刻。
 *   383.4.g / 383.4.g.1 规定“重复/激活一个命名触发”的做法：按条件检查指定的效果，把已
 *   满足条件的按“刚触发”放进链；本卡命名的就是它自己的 Play Effect
 *   （383.4.g.2 说明不产生真实的打出事件）。
 * - "play a ready 3 :rb_might: Sprite unit token with [Temporary] to your base"：
 *   187.2 的 Sprite 是域外 3 Might 单位 token，带 Fae 标签与 Temporary；440.2.c /
 *   185.2.a 的“打出新 token”= 先在链上生成再由打出流程接手（effect.token 的
 *   mode: "play"）。185.3.a 规定 token 没有费用（null，不是 0）。
 * - "ready" 是 143.4 / 185.2.d 的入场状态（token 沿用其类型的默认入场状态），
 *   effect.token 的文件头明确 “Entry overrides are not supported”，因此不能用事后
 *   effect.ready 代替（会产生多余的“成为就绪”事件并错过入场规定）。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. effect.token 的冻结 DEFINITIONS 表只有 recruit / sand-soldier / mech / reflection /
 *    tentacle；Sprite（187.2，带 Temporary 的 token）不在表内，该文件明确“带其他能力
 *    的定义保持 blocked/judge-required”。golden 用可解析定义验证同一 mode "play" 交接
 *    （create on Chain → play）已可用，并把 sprite 名的拒绝作为证据记录。
 * 2. “ready” 入场状态不可表达（143.4 / 185.2.d），见上；目的地“to your base”本身可写成
 *    控制器基地 { type: "base", player: "controller" }。
 * 3. [Temporary] 的 KeywordDef 与 beginning-start 展开已合入；当前卡牌程序绑定仍不能把
 *    该关键词的触发与 token 的完整生命周期接通。
 * 4. [Deathknell] 展开引用的 trigger.leave 原语仍未注册；显式的“Repeat this gear's play effect.”
 *    需要 383.4.g.1 的命名触发内部链入口（ogn/reckoners-arena 同样记录的缺口），
 *    当前内核仍没有该命名触发入口。
 * 效果正文（打出 Sprite token）已按 187.2 / 440.2.c / 185.2.a 的形状写出，但被 (1) 阻断；
 * golden 对被阻断的 token 名、可解析定义的交接、Temporary 展开体与 Deathknell 的 kill 半段
 * 给出真实执行证据，其余保持 test.todo；不近似实现。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "temporary" },
  {
    kind: "triggered",
    // 383.4.a / 383.4.a.1：Play Effect——打出的是本卡自身。
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        // 187.2 / 440.2.c / 185.2.a：打出新的 Sprite token，先在链上创建再交给打出流程。
        id: "sprite-fountain.play-sprite",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "sprite" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          // “to your base”：控制器基地。
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          linkKey: { kind: "constant", value: "spriteToken" }
          // “ready” 是入场状态改写（143.4 / 185.2.d），effect.token 明确不支持；
          // 不新增 IR 参数键，也不用事后 effect.ready 冒充。
          // “[Temporary]” 是 token 自身的印刷关键词（187.2），由 token 定义承载。
        }
      }
    ]
  },
  { kind: "keyword", keyword: "deathknell" },
  {
    kind: "triggered",
    // 808.1.c / 808.1.d：Deathknell 功能上等于 “When I die, [Effect]”；自身死亡触发在
    // 送入 Trash 前作为 Pending Item 进链（808.1.d.2、429.1.a.1.b）。这里按已合入先例
    // （sfd/unsung-hero、sfd/honest-broker）额外写出等价触发，使 [Effect] 正文可审查。
    trigger: {
      at: "object-killed",
      filter: { self: true, cause: "kill", destination: "trash" }
    },
    optional: false,
    body: [
      {
        // 808.1.b.1 的 [Effect] = “Repeat this gear's play effect.”；383.4.g.1 的命名触发
        // 内部链入口尚未接入，见文件头第 4 点；这里保留可审查的形状，尚不声称整卡可执行。
        id: "sprite-fountain.repeat-play-effect",
        op: "effect.activate-named-trigger",
        args: {
          namedTrigger: { kind: "constant", value: "play-effect" },
          scope: { kind: "constant", value: { source: "self" } },
          checkOtherConditions: { kind: "constant", value: true },
          emitOriginalEvent: { kind: "constant", value: false }
        }
      }
    ]
  }
];
export default {
  canonicalCardId:
    "card.hash-662d7db819f7136f036d9502c7ad7c650275c0c5bf7b8bd26034395aafbd7c0c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Sprite token（187.2：域外 3 Might 单位 token，带 Fae 标签与 [Temporary]）不在 effect.token 的冻结定义表" +
    "（recruit/sand-soldier/mech/reflection/tentacle），该文件明确带其他能力的定义保持 blocked/judge-required；" +
    "golden 用可解析定义证明同一 mode \"play\" 的「链上创建 + 打出」交接已可用，并把 sprite 名的 blockedReason 记录为证据。" +
    "(2) “ready” 是入场状态改写（143.4 / 185.2.d），effect.token 明确 “Entry overrides are not supported”；" +
    "先创建再补一次 effect.ready 会产生多余的“成为就绪”事件并错过入场规定，故不近似。" +
    "(3) [Temporary] 的 KeywordDef 与 beginning-start 展开已合入（golden 执行其 body），但卡牌程序绑定仍不能把该触发与 token 的完整生命周期接通。" +
    "(4) [Deathknell] 展开体引用的 trigger.leave 原语仍未注册；“Repeat this gear's play effect.” 需要 383.4.g.1 的命名触发内部链入口" +
    "（ogn/reckoners-arena 同样记录的缺口），当前内核没有对应命名触发入口。" +
    "依赖：Deathknell 的 trigger.leave 生命周期、effect.token 的 Sprite 定义与入场状态支持，" +
    "以及 383.4.g.1 的命名触发入口。不近似实现。",
  abilities,
  sourceText:
    "[Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)\n" +
    "When you play this, play a ready 3 :rb_might: Sprite unit token with [Temporary] to your base.\n" +
    "[Deathknell][>] Repeat this gear's play effect. (When this dies, get the effect.)"
} satisfies CardProgram;
