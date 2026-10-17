import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Azir, Ascendant (sfd-050-221) — Unit, Calm, Bird/Azir/Shurima/Champion.
 * energy 6, power 1 (Calm), Might 6.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-050-221，逐字）:
 *   ":rb_rune_calm:: [Action] — Choose a unit you control. Move me to its location and it to my original location. "
 *   "If it's equipped, you may attach one of its Equipment to me. Use only once per turn."
 *
 * 规则依据（CR v1.5）:
 * - 377.1：":" 之前是费用——本能力是一个启动能力，费用为 1 点 Calm Power（卡上有 Calm 域，
 *   134.2.b 的域符号与 :rb_rune_calm: 对应）。[Action] 是许可类关键词（806.1.c：可在任意
 *   玩家回合的 Showdown 期间打出/启动）；契约 3.1 的 activated 能力用 `timing: "action"`
 *   承载该许可，因此卡内不再重复声明 keyword。
 * - "Use only once per turn"：按 383.3.e 类的「每回合一次」使用上限，作为限制（Restriction）
 *   声明，不写进效果。
 * - "Choose a unit you control"：355.5/355.7——需要指名一个游戏对象，是目标；filter 用
 *   controller: "controller"（= "you"，由目标管线绑定为能力控制者）与 zone: "board"。
 * - "Move me to its location and it to my original location"（355.4、421.1、448.1、448.3）：两次 Move
 *   的目的地都必须在移动前锁定，否则第二次会读到已被移动后的位置；因此先用两条
 *   condition.value 分别捕获「我的原位置」与「被选单位的原位置」，再用 effect.move 的
 *   linked-value 目的地完成交换（契约 3.6 的符号选择器 + 3.9 的链接值，与已合入的
 *   ogn/tideturner 同一形状）。
 * - "If it's equipped, you may attach one of its Equipment to me"（818.3.b、435.1）：
 *   「可以」按契约 3.9 写成 choice.optional，被选指令（effect.attach）包进 body；
 *   「If it's equipped」是该选择节点的适用条件（只作用于本条指令，契约 3.4），用
 *   count + attachedTo 锚点判断被选单位身上是否附着带 Equipment 标签的 gear
 *   （150.1 规定带 Equipment 标签的 Gear 称为 Equipment；OBJECT_FILTER_ANCHORS 含
 *   attachedTo，解释器按锚点解析）。附着的对象在结算时从「附着在该单位上的 Equipment」
 *   里选（effect.attach 的 choose 形态），不是新的目标选择。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * - 启动能力没有卡牌程序 → 链的启动路径：契约 3.1 的 activated 能力要由链在 Finalize
 *   校验时机与限制，但没有任何已合入消费方把 CardProgram 的 activated 能力变成可启动的
 *   链项（src/programs/ 的绑定属未合入的 RIFT-257），因此费用（1 Calm Power）、[Action]
 *   许可与「每回合一次」限制都到不了判定点；已合入的 chain/engine.ts 的 restrictions 数组
 *   按 Condition 求值，而「once-per-turn」类使用上限没有对应的谓词消费方（与已合入
 *   rad/black-market 的 usage-limit 记录同一缺口）。
 * - 交换与附着本体只用已合入原语（condition.value、effect.move、effect.attach、
 *   choice.optional），golden 用解释器 + 参考内核真实执行（含拒绝分支与「未装备」分支）。
 * 依赖：RIFT-257（卡牌程序 → 链的启动/触发注册）、使用上限（usage-limit）的谓词消费方。
 * 不近似实现（不把「每回合一次」写进效果，也不手改位置或附着状态）。
 */
const BIND_ORIGIN: Instruction = {
  // 355.4 / 448.3：先锁我的原位置（第二次移动的目的地）。
  id: "azir-ascendant.read-origin",
  op: "condition.value",
  args: {
    value: { kind: "object-property", object: "self", property: "location" },
    key: { kind: "constant", value: "origin" }
  }
};

const BIND_CHOSEN_LOCATION: Instruction = {
  // 355.4 / 448.3：再锁被选单位的原位置（第一次移动的目的地）。
  id: "azir-ascendant.read-chosen-location",
  op: "condition.value",
  args: {
    value: {
      kind: "object-property",
      object: { target: "azir-ascendant.chosen-unit" },
      property: "location"
    },
    key: { kind: "constant", value: "chosenLocation" }
  },
  targets: [
    {
      id: "azir-ascendant.chosen-unit",
      filter: { type: "unit", zone: "board", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]
};

const MOVE_SELF: Instruction = {
  id: "azir-ascendant.move-me",
  op: "effect.move",
  args: {
    // "me" = 能力宿主（契约 3.6 的 "self"）。
    objects: { kind: "constant", value: "self" },
    to: {
      kind: "linked-value",
      instructionId: "azir-ascendant.read-chosen-location",
      key: "chosenLocation"
    },
    linkKey: { kind: "constant", value: "movedMe" }
  }
};

const MOVE_CHOSEN: Instruction = {
  id: "azir-ascendant.move-chosen",
  op: "effect.move",
  args: {
    objects: { kind: "constant", value: { target: "azir-ascendant.chosen-unit" } },
    to: {
      kind: "linked-value",
      instructionId: "azir-ascendant.read-origin",
      key: "origin"
    },
    linkKey: { kind: "constant", value: "movedChosen" }
  },
  targets: [
    {
      id: "azir-ascendant.chosen-unit",
      filter: { type: "unit", zone: "board", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]
};

const MAY_ATTACH: Instruction = {
  id: "azir-ascendant.may-attach-equipment",
  op: "choice.optional",
  args: {
    prompt: { kind: "constant", value: "Attach one of its Equipment to me?" },
    body: {
      kind: "constant",
      value: [
        {
          id: "azir-ascendant.attach-equipment",
          op: "effect.attach",
          args: {
            // 结算时从「附着在被选单位上的 Equipment」里选一张（150.1 的标签）。
            objects: {
              kind: "constant",
              value: {
                kind: "choose",
                id: "azir-ascendant.choose-equipment",
                filter: {
                  type: "gear",
                  tags: ["Equipment"],
                  attachedTo: { target: "azir-ascendant.chosen-unit" }
                }
              }
            },
            // 附着到 "me"（能力宿主）。
            host: { kind: "constant", value: { kind: "source" } },
            linkKey: { kind: "constant", value: "attachedEquipment" }
          }
        }
      ]
    }
  },
  // 363.2.a / 818.3.b："If it's equipped" 只作用于本条选择指令（契约 3.4 的条件作用域）。
  condition: {
    kind: "compare",
    left: {
      kind: "count",
      subject: "equipment",
      filter: {
        type: "gear",
        tags: ["Equipment"],
        attachedTo: { target: "azir-ascendant.chosen-unit" }
      }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  }
};

const abilities: Ability[] = [
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      // ":rb_rune_calm:" —— 1 点 Calm Power（377.1；本卡域为 Calm）。
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Calm"] }]
    },
    // "Use only once per turn"：使用上限（383.3.e 类），不是效果的一部分。
    restriction: { kind: "usage-limit", scope: "once-per-turn" },
    body: [BIND_ORIGIN, BIND_CHOSEN_LOCATION, MOVE_SELF, MOVE_CHOSEN, MAY_ATTACH]
  }
];

const program = {
  canonicalCardId: "card.hash-80f8e3cfb1efb8fa92d35b79b1509e929ecc65f84dfa4f899f2dd62f6019be4e",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "启动能力没有卡牌程序 → 链的启动注册路径：契约 3.1 的 activated 能力要由链在 Finalize 校验时机与限制，" +
    "但没有任何已合入消费方把 CardProgram 的 activated 能力变成可启动的链项（src/programs/ 的绑定属未合入的 RIFT-257），" +
    "费用（377.1 的 1 点 Calm Power）、[Action] 许可（806.1.c 的 Showdown 时机）与「Use only once per turn」限制都到不了判定点；" +
    "已合入的 chain/engine.ts 把 restrictions 当 Condition 求值，而 once-per-turn 使用上限没有对应的谓词消费方" +
    "（与已合入 rad/black-market 的 usage-limit 记录同一缺口）。" +
    "交换本体（355.4/448.3 先锁两个原位置，effect.move 用 linked-value 目的地）与带条件的可选附着" +
    "（choice.optional + count/attachedTo 条件 + effect.attach 的 choose 形态，818.3.b/435.1）只用已合入原语，" +
    "golden 用解释器 + 参考内核真实执行（含拒绝附着与未装备分支）。" +
    "依赖：RIFT-257（卡牌程序 → 链的启动/触发注册）、使用上限（usage-limit）的谓词消费方。不近似实现。",
  abilities,
  sourceText:
    ":rb_rune_calm:: [Action] — Choose a unit you control. Move me to its location and it to my original location. " +
    "If it's equipped, you may attach one of its Equipment to me. Use only once per turn."
} satisfies CardProgram;

export default program;
