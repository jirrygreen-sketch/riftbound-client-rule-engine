// RIFT-1168 card-data/effect contract regression.
//
// Official text source (read 2026-10-31):
// https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
// Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 819.1.d: Quick-Draw attaches when the Gear is played. CR 818.1.c and
// 818.2 define Equip and the Attach event. CR 435.1.d / 718.4 add its printed
// Might Bonus to the Top-Most card; CR 718.5.c / 719.3.a co-locate it when the
// Top-Most card moves. This test pins the shipped card contract and does not
// promote any additional card semantics.
import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../dist/index.js";
import longSword from "../../dist/cards/sfd/long-sword.js";

const LONG_SWORD =
  "card.hash-cab923a670e4baa826aa3de381c8b992bf33987fcb0d65feb75ca538a8681010";

test("RIFT-1168 Long Sword keeps the official Quick-Draw and Fury Equip contract", () => {
  assert.equal(longSword.canonicalCardId, LONG_SWORD);
  assert.equal(longSword.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(longSword.status, "executable");
  assert.equal(longSword.judgeReason, undefined);
  assert.equal(validateCardProgram(longSword).ok, true);
  assert.equal(longSword.sourceText,
    "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n" +
    "[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)");

  const [quickDraw, equip] = longSword.abilities;
  assert.deepEqual(quickDraw, { kind: "keyword", keyword: "quick-draw" });
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Fury");
  assert.deepEqual(equip.params, {
    cost: {
      kind: "activated",
      payments: [{
        kind: "power",
        amount: { kind: "constant", value: 1 },
        allowedDomains: ["Fury"],
      }],
    },
  });
  assert.equal(equip.params.cost.energy, undefined);
  assert.equal(equip.params.cost.payments.some(payment => payment.kind === "equip"), false);
});
