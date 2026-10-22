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
  // - status = judge-required: RIFT-891 now establishes the Champion Legend in
  //   its Legend Zone and proves the static grant through createMatch. The
  //   remaining blocker is the Shield defender's +1 Might in real combat
  //   (CR 814.1.c), which still lacks production evidence.
  canonicalCardId:
    "card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "createMatch 已将 Champion Legend 安置在公开 Legend 区，静态“Your Mechs have [Shield]”在真实对局中只向控制者自己的 Mech 授予 Shield 1。" +
    "剩余阻塞是 Shield 防守者 +1 Might（CR 814.1.c）尚缺真实战斗验证，因此整卡暂不标记 executable；不近似实现战斗收益。",
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
