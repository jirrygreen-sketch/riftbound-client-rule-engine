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
  // - status = judge-required (RIFT-889 review): the grant executes through a
  //   real binding, but createMatch keeps every Champion Legend in the chain
  //   zone because the engine has no Legend zone (CR 111), so this static never
  //   binds in a real game. Restore executable once RIFT-891 binds Legends in
  //   their zone and a createMatch golden proves it.
  canonicalCardId:
    "card.hash-fadaa09c681d3d967954f99504cd9d3d749242dc99dbc40d60adfa60bf53cca7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "对局中不生效：engine-core 无 Legend 区（CR 111），game/lifecycle.ts createMatch 以 create-token to chain 安置 championLegend，" +
    "实测本静态在 chain 区不绑定、己方 Mech 不获得 Shield；同一程序作为真实绑定的场上对象时只授予己方 Mech。依赖 RIFT-891，不近似实现。" +
    "Shield 防守者 +1 Might（CR 814.1.c）尚需真实战斗验证。",
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
