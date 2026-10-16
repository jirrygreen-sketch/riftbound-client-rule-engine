import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Miss Fortune, Buccaneer (ogn-193-298) — Unit, 4 energy + 1 Chaos power, 4 Might.
 *
 * Printed text:
 *   You may play me to an open battlefield.
 *   Friendly units may be played to open battlefields.
 *
 * 规则依据（CR v1.5）：
 * - 355.2 / 355.2.a：单位打出时选择合法 Location，默认只有控制者的 Base 或
 *   其控制的战场；355.2.b：游戏效果可以授予默认之外的合法位置。
 * - 170.11.c：Battlefield 称为 “open” 当且仅当它既 unoccupied（170.11.a：没有单位）
 *   又 uncontrolled（170.11.b：无玩家控制）。两句原文用的都是这个定义。
 * - 两句都是**静态许可**（“may be played”），不是触发能力也不是可选指令：
 *   “You may play me to an open battlefield” 只给本卡自己加一个合法位置；
 *   “Friendly units may be played to open battlefields” 是一个持续授予（本卡在场期间，
 *   控制者的所有友方单位都获得该许可）。契约 3.1 的 play 能力只有 restriction（限制）
 *   字段，没有许可字段，故按同类先例（sfd/dauntless-vanguard.ts 的
 *   `play-location-permission` 静态效果）表达两条能力，由 layers/Finalize 消费。
 *
 * status 判定（README 第 2 节）：judge-required。工程里没有任何消费方：
 * `play-location-permission` 在 engine-core/src 下只有卡片程序自身出现，layers 引擎
 * （`layers/engine.ts`）的 ability 层只处理 keyword/timing/movement/text，没有打出位置
 * 许可；Finalize 的合法位置校验也不读它。依赖：打出位置许可的持续效果消费方
 * （lanes/continuous.location，见 ability-templates 第 4 节 continuous.location 行）
 * 以及 Finalize 位置校验接线。本卡没有任何可执行原语，因此没有执行类 golden 用例。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { occupied: false, controlled: false },
          appliesTo: "self"
        }
      },
      duration: "while-in-hand"
    },
    condition: { kind: "always" }
  },
  {
    kind: "static",
    effect: {
      kind: "play-location-permission",
      value: {
        kind: "constant",
        value: {
          zone: "battlefield",
          battlefield: { occupied: false, controlled: false },
          appliesTo: "friendly-units"
        }
      },
      duration: "while-on-board"
    },
    condition: { kind: "always" }
  }
];

const program = {
  canonicalCardId: "card.hash-713732fef292fb529d388efbec2020949fdfaeca0c39e3afeb5ed43119a7f3e5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两条能力都是“打出位置许可”的静态持续效果（355.2.b / 170.11.c），但没有任何消费方：" +
    "play-location-permission 在 engine-core 内只出现在卡片程序自身，" +
    "layers 引擎的 ability 层不处理打出位置许可，Finalize 的合法位置校验也不读它。" +
    "依赖：continuous.location 打出位置许可消费方 + Finalize 位置校验接线。" +
    "本卡不含已合入的指令原语，golden 测试只做校验与结构断言。",
  abilities,
  sourceText:
    "You may play me to an open battlefield.\nFriendly units may be played to open battlefields."
} satisfies CardProgram;

export default program;
