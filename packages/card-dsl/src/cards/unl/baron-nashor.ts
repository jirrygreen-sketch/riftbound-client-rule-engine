import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Baron Nashor — CR v1.5 355.1/369.3 (as you play/entry replacement),
 * 187.9 (Baron Pit), 757.1/758.1 (enemy targeting prohibition),
 * 479.4/355.10.d (other friendly units +2 Might).
 * static/replacement 绑定、规则查询与位置选择器已合入，卡牌特有的剩余边界见
 * judgeReason。
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
          // LocationRef 能命名既有战场；创建一个新战场仍缺动作与定义（187.9）。
          location: { kind: "constant", value: { type: "battlefield", id: "baron-pit" } },
          linkKey: { kind: "constant", value: "baronPit" }
        },
        // “if it's not there already”：已存在 Baron Pit 战场 token 时不再创建。
        // tokenName 是描述性占位键（与 reksai-breacher 的 playedFromZoneNot 同一处理）：
        // 已合入的过滤器词汇没有“按 token 名称查战场”的维度，matchesObjectFilter 会静默
        // 忽略该键，于是这个 count 实际统计的是棋盘上的全部战场（实测 1 个无关战场也命中），
        // 不能当成“Baron Pit 是否已存在”的判定；该判定随 187.9 的定义与放置一起落地。
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
        // replacement.enter 已支持 state；location/ifCreated 仍是未消费的地点改写意图。
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
    "当前缺口（CR v1.5）：(1) effect.token 的冻结定义表没有 187.9 的 Baron Pit 战场定义（对 \"baron-pit\" 执行 negated(impossible)，已由 golden 实证），" +
    "也没有创建新 Location 的动作：GameAction 的 create-token 只接受既有 LocationRef，无法新增一个战场。" +
    "配套的 tokenName 存在性谓词没有查询消费方：matchesObjectFilter 会静默忽略该未知键（实测无关战场也会命中），" +
    "该 count 目前统计的是全部棋盘战场。(2) 355.1/355.1.a 的 As you play 决策不能等同于链结算时的 play.body；" +
    "369.3 的入场地点替代还需本次创建回执跨阶段关联——replacement.enter 只消费 state（缺 state 直接抛 BlockedReplacementError，已由 golden 实证），" +
    "不消费 location/ifCreated。位置选择器本身已合入（RIFT-357），不再是缺口。" +
    "(3) continuous.restrict 与 Finalize/Resolve 目标规则查询已合入，但当前 static 形状的 operation/forbidden/chooser 不能转换为仅禁止敌方法术与能力的 actions/作用者条件" +
    "（757.1/758.1）：实测按 chooser 查询同一对象的 restriction 对 A/B 两名玩家结果相同，无法区分敌我，不可改成所有玩家均不能选择。" +
    "(4) continuous.might 与 static 图层绑定已合入，但 programs/statics.ts 拒绝 exclude:source（实测抛 judge-required），仍不能对「其他友方单位」动态排除本源（479.4/355.10.d）。",
  abilities,
  sourceText:
    "As you play me, add the Baron Pit battlefield token to the board if it's not there already. If you do, I enter there. " +
    '(It has "Units can move here from anywhere.")\n' +
    "I can't be chosen by enemy spells and abilities.\n" +
    "Other friendly units have +2 :rb_might:."
} satisfies CardProgram;
