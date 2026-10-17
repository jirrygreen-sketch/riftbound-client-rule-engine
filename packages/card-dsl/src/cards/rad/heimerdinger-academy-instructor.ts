import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Heimerdinger, Academy Instructor (rad-132-167) — Unit, Order,
 * 6 energy / 1 power / 5 Might，标签 Yordle/Heimerdinger/Piltover/Champion。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-132-167):
 *   "If you would play a unit token to a location while I'm at a battlefield,
 *    you may play a 3 :rb_might: Mech unit token to that same location instead."
 *
 * 规则依据（CR v1.5）：
 * - "If you would play ... instead"：替代效果（369.1 的 "would" 判定语）。"you may"
 *   使之为可选替代（369.x 的选择；参考 events/pipeline.ts 的 optional replacement
 *   询问机制）。按契约 3.1 用 kind: "replacement" + replaces: EventPattern + with。
 * - "play a unit token"：被替代的游戏动作是"打出一个单位衍生物"，对应打出事件
 *   card-played 且对象为衍生物（185.1 的 token 内在类别、187.4 的 Mech 衍生物定义、
 *   350.2 衍生物可被打出）；衍生物的打出先在链上创建再交付 play（440.2.c/185.2.a）。
 * - "a 3 :rb_might: Mech unit token"：187.4 的 3 Might Mech 定义，effect.token 的
 *   "mech" 定义即该值（本程序不发明衍生物能力）。
 * - "while I'm at a battlefield"：来源的位置（198.2/199.1 位置是永久物的特征）为战场，
 *   写成对来源的命名谓词（同 fiora-peerless 的 one-on-one 先例），由图层/触发上下文求值。
 *
 * 无法执行的依赖（保持 judge-required）：
 * - 当前替代绑定能够匹配 card-played 事件，但 replacement planner 没有把 effect.token
 *   规划成可提交的 GameAction 序列；因此不能完成“创建并打出 Mech token”的替代提交。
 * - "to that same location"：替代动作的目标位置 = 被替代的打出动作将前往的位置。IR 中
 *   没有"被替代事件的 location"选择器；下面的 location 是有意标出的占位常量
 *   （replaced-play-location），必须由替代系统在结算时绑定为被替代打出的目的地——
 *   用来源自身的位置会在这两者不同时给出错误结果，因此这里不用 object-property。
 * - replacement.event 已能声明 optional，但 instead 要求裸指令数组，与卡牌 Expr 包装不兼容。
 * - 来源战场位置与己方 unit token 门控仍是待绑定描述，不能把命名常量当成已求值谓词。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: {
      event: "card-played",
      object: { type: "token" }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "source-at-a-battlefield" }
    },
    with: [
      {
        id: "heimerdinger-academy-instructor.play-mech-instead",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "mech" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          // 占位：真实值是被替代的打出动作的目标位置，须由替代管线绑定。
          location: { kind: "constant", value: { type: "battlefield", id: "replaced-play-location" } },
          linkKey: { kind: "constant", value: "replacementToken" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-110bcd60a1458cca7d33a12f05a6abe079166042a12661fcba8d64b94016e80a",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "369.1 的替代仍缺：(1) replacement/planner 未支持 effect.token，不能提交创建并打出 Mech 的动作序列；" +
    "(2) 替代输入仅暴露 replacement.object，未向 IR 绑定被替代 play 动作的 destination；现有 LocationExpr " +
    "可读对象当前位置，但不能用它替代待打出的目的地。" +
    "(3) replacement.event 已有 optional 机制，但 instead 要求裸指令数组，与 Instruction.args 的 Expr 包装不兼容，" +
    "本卡的直接 with 形状也未声明 you may。" +
    "来源须位于战场、仅替代己方 unit token 的门控尚未落地；source-at-a-battlefield 只是描述性常量。",
  abilities,
  sourceText:
    "If you would play a unit token to a location while I'm at a battlefield, you may play a 3 :rb_might: Mech unit token to that same location instead."
} satisfies CardProgram;

export default program;
