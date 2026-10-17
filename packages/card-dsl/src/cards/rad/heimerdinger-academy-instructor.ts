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
 * 无法执行的依赖（保持 judge-required；2026-10-17 复核，均为实测）：
 * - replacement/planner.ts 仍把 effect.token 判为 “Unsupported replacement opcode”，
 *   所以计划不出“在链上创建 Mech token 再交付 play”的动作序列，替代无法提交（440.2.c）。
 * - "to that same location"：替代动作的目的地是被替代 play 动作将前往的位置。
 *   replacement/bind.ts 只向 IR 暴露被替代事件的对象绑定（REPLACED_EVENT_LINK），
 *   GameEvent/GameAction 里 play 动作的 location 既没有链接键也没有链接选择器；下面的
 *   location 是有意标出的占位常量（replaced-play-location），不能换成来源自身位置——
 *   来源在战场 A 而打出动作前往战场 B 时，用来源位置会给出错误结果。
 * - "you may ... instead" 的可选询问没有落地：EffectsIR 的 instruction.args 值必须是 Expr，
 *   而 replacement.event 的 instead 只接受字面量数组（bindReplacement："must be an instruction body"），
 *   裸指令数组无法写进 args（validateCardProgram 报 invalid-expression）。直接 `with` 形状
 *   则完全不声明 optional（bindReplacement 得到的 registration 无 optional 字段）。
 * - 来源战场位置与仅替代己方 unit token 的门控仍是待绑定描述：source-at-a-battlefield
 *   只是描述性常量，没有任何已合入谓词求值它，不能当作已实现条件。
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
    "369.1 的替代仍缺（实测）：(1) replacement/planner.ts 对 effect.token 抛 Unsupported replacement opcode，" +
    "不能计划「在链上创建 Mech token 再交付 play」的动作序列（440.2.c）；" +
    "(2) 替代输入只暴露被替代对象（REPLACED_EVENT_LINK = replacement.object），没有 play action 的 destination 选择器，" +
    "现有 LocationExpr 只读对象当前位置，不能用它替代待打出的目的地；" +
    "(3) replacement.event 的 optional 与 args 的 Expr 契约不兼容：bindReplacement 只接受字面量数组 args.instead，" +
    "裸指令数组写进 instruction.args 会被 validateCardProgram 判 invalid-expression；直接 with 形状不声明 optional。" +
    "来源须位于战场、仅替代己方 unit token 的门控尚未落地；source-at-a-battlefield 只是描述性常量。",
  abilities,
  sourceText:
    "If you would play a unit token to a location while I'm at a battlefield, you may play a 3 :rb_might: Mech unit token to that same location instead."
} satisfies CardProgram;

export default program;
