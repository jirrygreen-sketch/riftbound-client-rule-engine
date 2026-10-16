import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Baron Nashor (unl-147-219) — Unit, Chaos, tag The Void. energy 10, power 3, Might 12.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-147-219，逐字）：
 *   As you play me, add the Baron Pit battlefield token to the board if it's not there
 *   already. If you do, I enter there. (It has "Units can move here from anywhere.")
 *   I can't be chosen by enemy spells and abilities.
 *   Other friendly units have +2 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 355.1 / 355.1.a：“As you play me …” 是打出这张牌时作出的动作/决定，属打出流程的
 *   “as you play” 部分；369.3 直接以本卡为“替代单位进场方式”的官方例子，说明最后一句
 *   “If you do, I enter there.” 是替代效果，把“在原本的打出位置进场”替换成“在 Baron Pit 进场”
 *   （契约 3.5 把替代建模为 replacement 能力，在动作执行前拦截）。
 * - 187.9：Baron Pit 是无域战场 token，自带 “Units can move here from anywhere.”；
 *   “add … to the board if it's not there already” 是打出时的 token 创建加“已存在则不再创建”。
 * - 757 / 757.1 / 758：“I can't be chosen by enemy spells and abilities” 正是 757.1 描述的
 *   Untargetable 被动能力形式（757.2 的官方例子即 Ruin Runner 的同句），是持续禁止，
 *   由目标合法性检查消费（758.1 的结算时重验属 target 系统）。
 * - “Other friendly units have +2 :rb_might:” 是算术层（479.4）的持续 Might 修正；
 *   集合按特征程序化选出（355.10.d：不取目标），“other” 排除宿主（740.1.a 的 friendly 定义）。
 *
 * status = judge-required（缺口不近似实现）：
 * - 187.9 的 Baron Pit **战场** token 不在 effect.token 的冻结 DEFINITIONS 表里，且“把战场 token
 *   放到棋盘上”没有原语语义：create-token 的目的地是 LocationRef（base / 既有 battlefield），
 *   无法表达“创建一个新战场”，本卡声明的 location 会被 argsSchema 直接拒绝。
 * - 369.3 的 “If you do, I enter there” 是入场替代：没有把 CardProgram 的 replacement 能力注册进
 *   替代的消费方（事件管线只以动作匹配器注册替代），with 体引用的 replacement.enter 也没有已注册的
 *   InstructionDef；事后用 effect.move 冒充会产生一次真实移动事件且落在错误位置，故不近似。
 * - “I can't be chosen by enemy spells and abilities” 是 757/758 的 Untargetable 持续禁止：
 *   缺 continuous.restrict 与目标合法性的消费方（目标管线只消费调用方传入的过滤器与 tax）。
 * - “Other friendly units have +2 [M]” 是 479.4 算术层的 continuous.might 静态修正：
 *   没有卡牌 static 能力 → 图层注册的消费方，layers 的 conditionMatches 也只识别
 *   always/never/type/has-tag/has-keyword。
 * 依赖：RIFT-62 后续（战场 token 定义与放置）、RIFT-260（replacement 绑定）、
 * RIFT-259/91（continuous.restrict / continuous.might 消费）、RIFT-90（目标合法性）。
 */
const abilities: Ability[] = [
  {
    // 355.1 / 355.1.a：“As you play me, …” 是打出本牌时作出的动作，按契约 3.1 的 play 能力书写。
    kind: "play",
    body: [
      {
        id: "baron-nashor.add-baron-pit",
        op: "effect.token",
        args: {
          // 187.9 的 Baron Pit battlefield token：定义缺席（见文件头与 judgeReason）。
          token: { kind: "constant", value: "baron-pit" },
          amount: { kind: "constant", value: 1 },
          // “add … to the board”：直接创建到棋盘（440.2），不是链上打出。
          mode: { kind: "constant", value: "create" },
          // 战场 token 的放置：LocationRef 只能命名 base 或既有 battlefield，无法表达“新战场”，
          // 该项会被 effect.token 的 argsSchema 拒绝（见 judgeReason）。
          location: { kind: "constant", value: { type: "battlefield", id: "baron-pit" } },
          linkKey: { kind: "constant", value: "baronPit" }
        },
        // “if it's not there already”：已存在 Baron Pit 战场 token 时不再创建。
        // tokenName 是描述性占位键（与 reksai-breacher 的 playedFromZoneNot 同一处理）：
        // 已合入的过滤器词汇没有“按 token 名称查战场”的维度，该判定随 187.9 的定义与放置一起落地。
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "objects",
            filter: { zone: "board", type: "battlefield", tokenName: "Baron Pit" }
          },
          operator: "eq",
          right: { kind: "constant", value: 0 }
        }
      }
    ]
  },
  {
    // 369.3：最后一句是“进场方式”的替代效果（官方以本卡为例）。
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { source: "self" }
    },
    with: [
      {
        id: "baron-nashor.enter-baron-pit",
        // 契约 3.1 的 replacement.with 只接受 Instruction[]，而“改变入场地点”没有已注册的原语：
        // 按 replacement.enter 家族声明该改写意图（与 ogn/iron-ballista 的入场状态改写同一处理）。
        op: "replacement.enter",
        args: {
          location: { kind: "constant", value: { type: "battlefield", id: "baron-pit" } },
          // “If you do”：以打出过程中那一次创建的回执为条件（369.3 的 “if it was created”）。
          // 合并 IR 无法跨能力读取创建回执，故用带命名 subject 的 count 记录该谓词
          // （与 virtuoso 的 energy-spent-on-the-played-spell 同一惯例）。
          ifCreated: {
            kind: "constant",
            value: "baron-pit-created-this-play"
          }
        }
      }
    ]
  },
  {
    // 757 / 757.1 / 758：Untargetable 持续禁止（“can't be chosen by enemy spells and abilities”）。
    kind: "static",
    effect: {
      kind: "continuous.restrict",
      operation: "target",
      forbidden: true,
      appliesTo: "self",
      chooser: "opponent",
      filter: { type: "unit", controller: "controller", zone: "board" }
    }
  },
  {
    // “Other friendly units have +2 [M]”：479.4 算术层的持续修正，集合由特征选出（355.10.d）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      filter: {
        zone: "board",
        type: "unit",
        controller: "controller",
        exclude: "source"
      }
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-f38d5cb54f004209cfc8fd9489817ccc83394ce2f7125972d8538d18c193cc6d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口（均不近似实现）：(1) 187.9 的 Baron Pit 战场 token 不在 effect.token 的冻结 DEFINITIONS 表里，" +
    "且“把战场 token 放到棋盘上”没有原语语义——create-token 的目的地是 LocationRef（base / 既有 battlefield），" +
    "无法表达“创建一个新战场”，本卡声明的 location 会被 argsSchema 直接拒绝。" +
    "(2) 369.3 的“If you do, I enter there”是入场替代：没有把 CardProgram 的 replacement 能力注册进替代的消费方" +
    "（事件管线只以动作匹配器注册替代），with 体引用的 replacement.enter 也没有已注册的 InstructionDef；" +
    "不用事后 effect.move 冒充（会多出一次真实移动事件，且会落在错误位置）。" +
    "(3) “I can't be chosen by enemy spells and abilities”是 757.1 的 Untargetable（757/758）：" +
    "缺 continuous.restrict 与目标合法性的消费方，目标管线只消费调用方传入的过滤器与 tax。" +
    "(4) “Other friendly units have +2 :rb_might:”是 479.4 算术层的 continuous.might 静态修正：" +
    "没有卡牌 static 能力 → 图层注册的入口，layers 的 conditionMatches 也只识别 always/never/type/has-tag/has-keyword。" +
    "依赖：RIFT-62 后续（战场 token 定义与放置）、RIFT-260（replacement 绑定）、" +
    "RIFT-259/91（continuous.restrict / continuous.might 消费）、RIFT-90（目标合法性）。",
  abilities,
  sourceText:
    "As you play me, add the Baron Pit battlefield token to the board if it's not there already. If you do, I enter there. " +
    '(It has "Units can move here from anywhere.")\n' +
    "I can't be chosen by enemy spells and abilities.\n" +
    "Other friendly units have +2 :rb_might:."
} satisfies CardProgram;
