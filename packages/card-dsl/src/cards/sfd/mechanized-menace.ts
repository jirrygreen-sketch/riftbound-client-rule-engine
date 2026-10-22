import type { CardProgram } from "../../ir/index.js";

const mechanizedMenace = {
  // Mechanized Menace — Rumble's Champion Legend (Spiritforged, sfd-181-221).
  //
  // Rules evidence (Core Rules v1.5):
  // - 801.3.a: "Your Mechs have [Shield]" is an effect granting the Shield
  //   keyword to every Mech unit the legend's controller controls.
  // - 814.1.b.3 / 814.1.c: the granted Shield omits its value, so X is
  //   presumed to be 1, and it is functionally "while I am a defender, I
  //   have +1 [M]" — matching the reminder text in sourceText.
  // - 814.2: Shield granted from multiple sources stacks (values sum), which
  //   the "shield" KeywordDef owns (stacking: "sum").
  // - The layers system (P0 contract 3.4) owns the actual continuous grant;
  //   this program only describes it for the KeywordDef expansion to consume.
  // - Tags match case-sensitively and the catalog / CR 187.4 Mech token spell
  //   the tag "Mech"; the earlier lowercase "mech" matched no real card
  //   (RIFT-889 probe).
  // - status = judge-required: RIFT-891 establishes the Champion Legend in its
  //   Legend Zone and the static grant works through createMatch. The current
  //   production keyword re-expansion set omits Shield, so the granted Shield
  //   never contributes its derived continuous.might to a real damage plan.
  canonicalCardId:
    "card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "createMatch 已把 Champion Legend 安置在公开 Legend 区，静态“Your Mechs have [Shield]”已通过 createProgramBinding + attachLifecycle 向控制者自己的 Mech 正确授予 Shield 1。" +
    "剩余真实战斗缺口是 granted Shield 的派生 Might：Shield KeywordDef 的 continuous.might 展开只存在于参考 KeywordGrantLayerEngine；" +
    "生产 programs/statics.ts:244-260 的 KeywordGrantLayerEngine 只为 Vision/Ganking/Deflect/Assault 生成派生静态效果，没有把 Shield 纳入重展开集合。" +
    "CombatFlow 的 Defender 角色已进入 combat/transactions/damage.ts:162-171 送入 LayerEngine 的 runtime.units，且 flow.snapshot 为 defender（combat/flow.ts:117、208-229、310-327、383-406），" +
    "所以真实伤害计划防守方预算仍为印刷 3 而非 4，整卡继续 judge-required；不近似实现战斗收益（CR 466.2.c.3、801.3.a.1、814.1.c、814.1.d.1）。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "grant-keyword",
        keyword: "shield",
        value: { kind: "constant", value: 1 },
        filter: {
          type: "unit",
          tag: "Mech",
          controller: "controller",
          zone: "board"
        }
      }
    }
  ],
  sourceText:
    "Your Mechs have [Shield]. (+1 :rb_might: while they're defenders.)"
};

export default mechanizedMenace;
