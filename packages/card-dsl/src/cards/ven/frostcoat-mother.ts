import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Frostcoat Mother (ven-032-166) — Unit, Calm, 3 Energy, Might 3, tag Dog/Freljord.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-032-166，逐字）：
 *   [Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune you
 *   control. (Pay the cost: Empower me. Use only if not Empowered.)
 *   [Empowered][>] I have +3 :rb_might:.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c / 827.1.c.1：[Empower] 是启动能力关键词，本卡印刷费用 12 Energy；
 *   按契约 3.7 卡牌只声明 { kind: "keyword", keyword: "empower", value: 12 }，展开
 *   （cost.activated + effect.empower + “仅未 Empowered 时启动”）归 keywords/。
 * - 827.1.c.3 / 206.1：Empower 能力也可以带有修改该 Empower 费用的文本；任何需要确定
 *   该卡 Empower 费用的场合都要计入。因此 “This ability costs 1 less for each rune you
 *   control” 是这条 Empower 起动费用的一部分，不是独立效果——程序用一条指向
 *   "empower-activation-cost" 的 continuous.cost-modification 记录（per: "rune-you-control"），
 *   由费用/关键词侧消费；不改 IR 类型（同 ven-050-166 Grumpy Rockbear 的写法）。
 * - 190.6.d：“you control” 的隐含 “you” 是能力控制者；133.5.a.1 / 431.1：已 channel 的
 *   符文留在控制者的符文区，所以 “each rune you control” = 控制者符文区中的符文数量。
 * - 828.1.b / 828.1.b.1：”[Empowered][>] I have +3 :rb_might:” 是依赖能力，只在宿主拥有
 *   Empowered 状态时 Active；+3 Might 属 layers 的 arithmetic 层（143.2/143.2.a、479）。
 *
 * status = judge-required（复核 2026-10-17，实测证据）：
 * 1. 没有 Empower / Empowered 的 KeywordDef：expandProgram 抛 ProgramBindingError
 *    （Keyword empower has no executable KeywordDef），827.1.c.1 的起动费用与 “Use only if not
 *    Empowered” 限制没有展开实现；
 * 2. 没有 Empowered 状态谓词（442.1.a）：“[Empowered][>]” 的门控没有可求值形态；
 * 3. continuous.cost-modification 的静态声明无法绑定：staticTarget() 不认识 appliesTo
 *    "empower-activation-cost"，实测 createEngineStaticBinder().bindStatic 抛 ProgramBindingError；
 *    即使绑定成功也没有 Empower 费用消费方读取该修改。
 * continuous.might 指令和图层求值已合入，但条件谓词与第 3 条同因，未 Empowered 时也可能生效。
 */
const abilities: Ability[] = [
  {
    // 827.1.c.1：印刷费 12 Energy；不伪造启动能力（见 judgeReason）。
    kind: "keyword",
    keyword: "empower",
    value: 12
  },
  {
    // 827.1.c.3 / 206.1：该文本只改这条 Empower 起动费用（每控制 1 枚符文少 1 Energy）。
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      resource: "energy",
      appliesTo: "empower-activation-cost",
      per: "rune-you-control",
      minimum: 0,
      value: {
        kind: "count",
        subject: "runes",
        filter: { type: "rune", controller: "self", zone: "rune-zone" }
      }
    }
  },
  {
    // 828.1.b.1 的依赖能力：宿主 Empowered 时获得 +3 Might（arithmetic 层）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 3 }
    },
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "empowered" }
    }
  }
];

export default {
  canonicalCardId: "card.hash-af86d71346754f5a19f63ebf193cb978f3d3dffe541f342d86bd89ab951eefb8",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Empower / Empowered KeywordDef：实测 expandProgram 抛 ProgramBindingError（Keyword empower has no " +
    "executable KeywordDef），827.1.c.1 的起动费用与未 Empowered 限制尚未展开；缺 Empowered 状态谓词" +
    "（442.1.a/828.1.b.1）。827.1.c.3 的每符文减费声明无法绑定：staticTarget() 不认识 appliesTo " +
    "\"empower-activation-cost\"，实测 createEngineStaticBinder().bindStatic 抛 ProgramBindingError" +
    "（Unsupported static appliesTo），且没有 Empower 费用消费方读取该 continuous.cost-modification。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune you control. (Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +3 :rb_might:."
} satisfies CardProgram;
