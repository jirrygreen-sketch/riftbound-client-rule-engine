// RIFT-598 template-level golden. Each row is an independent card assertion.
// The production binding is used to expand declared keywords; cards whose
// source includes additional abilities or an unregistered keyword remain
// judge-required and assert the precise fail-closed reason.
import assert from "node:assert/strict";
import test from "node:test";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";

const rows = [
  {"canonicalCardId": "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6", "programPath": "sfd/laurent-duelist", "abilities": [{"kind": "keyword", "keyword": "assault", "value": 2}], "expectedExpanded": ["static:continuous.might"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-63dae663a2ca549dc4704d2814cdc3b2eea4a26845d09029e88d2c8df6ee0013", "programPath": "sfd/skyfall-of-areion", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-f9c6d6052ec4552cfcfc53a0e584e07cb232189ed89b277126630202cc188050", "programPath": "sfd/blade-of-the-ruined-king", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-b5a71d562e350fc2da5172cbd7a0ef37531661ac9a27651a3cdfc1784f22b918", "programPath": "sfd/sentinel-adept", "abilities": [{"kind": "keyword", "keyword": "weaponmaster"}], "expectedExpanded": ["triggered"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-6ef5f0dfecb89d68422cd4fa23ea64d155ef384d03c974ea67ff920203e89a46", "programPath": "sfd/dorans-shield", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-f9773189acce6bbb236b5fe609b108079a3b1b13064783ef685543fb56e8e969", "programPath": "sfd/experimental-hexplate", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-d7b135744e67346532eafa70ee68b6299b7a78117c7e704b524f1c7c3c538d72", "programPath": "sfd/laurent-bladekeeper", "abilities": [{"kind": "keyword", "keyword": "ganking"}], "expectedExpanded": ["static:continuous.movement"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-a94953e6e26ed3d9751a4dd5e4674a587232a894999224e5ce566be1f0895d89", "programPath": "sfd/last-rites", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-d5460ff7a266a84e1d15b39abe9c2fab99ba81b021a0b01c90e649cc36071665", "programPath": "sfd/brutalizer", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-67da502bedfc109e81093202c4a30a43cf37ca8aada9f1460b33bee5c979fdae", "programPath": "sfd/eye-of-the-herald", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-b789f6d844c0da0576802aca0c36d51a7475c3c3c62c21b9ef4092438971fafe", "programPath": "sfd/svellsongur", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 2}], "expectedExpanded": ["activated"], "keywordOnly": true, "sourceHasAdditionalAbility": true},
  {"canonicalCardId": "card.hash-2d46595233b37a0868857eab035ad4fa4dc53fc8c932d35ad32cca2c54ff06d2", "programPath": "sfd/serrated-dirk", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-7a011777b95befa4fad1e25df22ffc8e9707030c4927ee2c5297fb8128a01ef4", "programPath": "sfd/master-bingwen", "abilities": [{"kind": "keyword", "keyword": "weaponmaster"}], "expectedExpanded": ["triggered"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-af3547abb5e6d69c2372b62331d6039acaf16cca337eefb27e5734bbee3fb307", "programPath": "sfd/guardian-angel", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-db90e8eaf24230cfbc3b68d99971c58f465f65465b5c52be37ae1564d6e86732", "programPath": "sfd/jaull-fish", "abilities": [{"kind": "keyword", "keyword": "accelerate"}], "expectedExpanded": ["static:accelerate.cost", "replacement"], "keywordOnly": true, "sourceHasAdditionalAbility": true},
  {"canonicalCardId": "card.hash-553d60be98d221dc71d4e71eb6ae5938143fa0c4b71e6e96d27d8570521d36eb", "programPath": "sfd/recurve-bow", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-b3976fdbbb870e1d3f2e8cd4a8c353a35d653828284910792b79b5d6e6982f12", "programPath": "ven/soulspinner", "abilities": [{"kind": "keyword", "keyword": "ambush"}], "expectedExpanded": ["static:play-location-permission", "static:continuous.timing"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-9e6cf771d3c68dc759e26aa3068eb3f3f2873734ee60fe6d8df8ef5a2ac46dbe", "programPath": "ven/horns-of-the-dragon", "abilities": [{"kind": "keyword", "keyword": "tank"}], "expectedExpanded": ["static:continuous.combat"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-5d66044d59f3bf4f17b4143a7229c8e12673e34e92591de0005f64fad8dd2a82", "programPath": "rad/ksante-dauntless", "abilities": [{"kind": "keyword", "keyword": "shield"}, {"kind": "triggered"}, {"kind": "triggered"}], "expectedExpanded": ["static:continuous.might"], "keywordOnly": false},
  {"canonicalCardId": "card.hash-bbba13a99fc64b76e1aea5bf99acad154b4526f0661f19a3ac11162fced5801a", "programPath": "rad/nazuman-ntofo", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-480ea79884e6f85ff72527f8deb9eb55bbcacb01a51c7d33332e8d830f2c20fe", "programPath": "rad/demacian-standard", "abilities": [{"kind": "keyword", "keyword": "deploy"}, {"kind": "triggered"}, {"kind": "triggered"}], "expectedExpanded": ["static:continuous.location", "triggered"], "keywordOnly": false},
  {"canonicalCardId": "card.hash-03f357977584ddf7e53bbe67b5c7b5c02cdcafe1cf40d289953589949e85d0d4", "programPath": "rad/concert-poster", "abilities": [{"kind": "keyword", "keyword": "deploy"}, {"kind": "triggered"}, {"kind": "triggered"}], "expectedExpanded": ["static:continuous.location", "triggered"], "keywordOnly": false},
  {"canonicalCardId": "card.hash-e6d9cb8b5b7516aaf9f0acb84629037ed610be0c027965d443bbe45210273059", "programPath": "ogn/pakaa-cub", "abilities": [{"kind": "keyword", "keyword": "hidden"}], "expectedExpanded": ["static:cost.hidden"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-67d8869cd0857c707456cbffeef13e8907581ac91c85c5b70d64ee7c128db452", "programPath": "ogn/pouty-poro", "abilities": [{"kind": "keyword", "keyword": "deflect"}], "expectedExpanded": ["static:target.tax"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-d758a4eb01d27daf80036a95c8930bef4e01df5c77bf18f8f92392c7dd708701", "programPath": "ogn/stalwart-poro", "abilities": [{"kind": "keyword", "keyword": "shield"}], "expectedExpanded": ["static:continuous.might"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-610cc33146e5be610b1b548bd327d47a44aba21edb081e7669cba4971753ccef", "programPath": "ogn/sprite", "abilities": [{"kind": "keyword", "keyword": "temporary"}], "expectedExpanded": ["triggered"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-a276ed720995bb4d684f3f838182e4271ea398c1cac8f48837c9e7c292cd0497", "programPath": "ogn/legion-rearguard", "abilities": [{"kind": "keyword", "keyword": "accelerate"}], "expectedExpanded": ["static:accelerate.cost", "replacement"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-2daf12389f3f2209c75815321b3f70aaadfe8d1f9e8cc4b3dd747c93c0f780dc", "programPath": "ogn/petty-officer", "abilities": [{"kind": "keyword", "keyword": "assault"}], "expectedExpanded": ["static:continuous.might"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-406baf0c2f39d1eb52f69f43bb251ddd06afca820b412de6486e3112ed87bb21", "programPath": "ogn/daring-poro", "abilities": [{"kind": "keyword", "keyword": "assault"}], "expectedExpanded": ["static:continuous.might"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-d2580c0f7a993eb938c0e656fc955d9a10d34e35758dbfed9502de2a75828f9d", "programPath": "unl/hunters-machete", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-87e2eedcbebff6711e1c1841d161efbe5d63d047836446fb4ececd034911f1be", "programPath": "unl/soul-sword", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-955bd858659e4d3eb8edfd20347a7496c51932de05cafd32fc71d86d94f96e47", "programPath": "unl/hextech-gauntlets", "abilities": [{"kind": "keyword", "keyword": "equip", "value": 3}], "expectedExpanded": ["activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-f8b8f40872bd80284cc23f0fb215719625d48e00be1b8ed248c2a494ad0a5bad", "programPath": "unl/voracious-gromp", "abilities": [{"kind": "keyword", "keyword": "hunt", "value": 3}], "expectedExpanded": ["triggered", "triggered"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-f57b9ca8014fe44251722063cac371908fc07829fc257206b3c21b2c62f38d89", "programPath": "sfd/forgefire-cape", "abilities": [{"kind": "keyword", "keyword": "unique"}, {"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": [], "keywordOnly": true},
  {"canonicalCardId": "card.hash-b9ee923133a3002010f175ddd77b690a710fa21bed8ffaefa29904a936c710ca", "programPath": "sfd/steraks-gage", "abilities": [{"kind": "keyword", "keyword": "quick-draw"}, {"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": ["static:continuous.timing", "triggered", "activated"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-963c1bf1475a7d2678d6b10353dd2919b09c2bac0c8a471f44fdf8d090a65c02", "programPath": "sfd/rabadons-deathcrown", "abilities": [{"kind": "keyword", "keyword": "unique"}, {"kind": "keyword", "keyword": "equip", "value": 1}], "expectedExpanded": [], "keywordOnly": true},
  {"canonicalCardId": "card.hash-8518a281524e1e72c165821192f2957a4ce78725737d98dbb03e70569739aec0", "programPath": "sfd/armed-assailant", "abilities": [{"kind": "keyword", "keyword": "accelerate"}, {"kind": "keyword", "keyword": "weaponmaster"}], "expectedExpanded": ["static:accelerate.cost", "replacement", "triggered"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-4cb8d7a21af85e64b1351cadd5764e7d72532c46a93c2c85289c8c4351c33818", "programPath": "ogs/garen-rugged", "abilities": [{"kind": "keyword", "keyword": "assault", "value": 2}, {"kind": "keyword", "keyword": "shield", "value": 2}], "expectedExpanded": ["static:continuous.might", "static:continuous.might"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-0386094f508d9cbd2f5fca31e0757380fa1c42cf0e9124b48b8a32d75b9fddc4", "programPath": "ogn/sunlit-guardian", "abilities": [{"kind": "keyword", "keyword": "shield"}, {"kind": "keyword", "keyword": "tank"}], "expectedExpanded": ["static:continuous.might", "static:continuous.combat"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-a9d231899d6f3cc46b5f8d00320977ba937b799647d39e1c0b6ccf4ddb83b162", "programPath": "unl/sharkling", "abilities": [{"kind": "keyword", "keyword": "accelerate"}, {"kind": "keyword", "keyword": "assault", "value": 4}], "expectedExpanded": ["static:accelerate.cost", "replacement", "static:continuous.might"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-ab13903af22d097efdc5e4e666b4055e6ef532fd5138f05aef5bd99a8ae78a8c", "programPath": "unl/gemhand-hunter", "abilities": [{"kind": "keyword", "keyword": "hunt"}, {"kind": "keyword", "keyword": "level", "value": 6}], "expectedExpanded": ["triggered", "triggered", "static:condition.predicate"], "keywordOnly": true, "sourceHasAdditionalAbility": true},
  {"canonicalCardId": "card.hash-954548f2a1317ac2bc2954489da0730ecf613acc22887c0dc6c46d250c025391", "programPath": "unl/towering-combatant", "abilities": [{"kind": "keyword", "keyword": "shield", "value": 2}, {"kind": "keyword", "keyword": "tank"}], "expectedExpanded": ["static:continuous.might", "static:continuous.combat"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-772d03e9b0b696718afe836a8028877765e2a10ff2fd39781dc7d52e3b05e8b8", "programPath": "unl/mutated-mouser", "abilities": [{"kind": "keyword", "keyword": "shield", "value": 2}, {"kind": "keyword", "keyword": "tank"}], "expectedExpanded": ["static:continuous.might", "static:continuous.combat"], "keywordOnly": true},
  {"canonicalCardId": "card.hash-90eefb9ab8b0769620abebf96a6feb3bfd91535bf652b0311542f4d61d68a2e7", "programPath": "unl/inferna", "abilities": [{"kind": "keyword", "keyword": "ambush"}, {"kind": "keyword", "keyword": "assault", "value": 2}], "expectedExpanded": ["static:play-location-permission", "static:continuous.timing", "static:continuous.might"], "keywordOnly": true},
];
function normalizeAbility(ability) {
  if (ability.kind === "keyword") {
    return ability.value === undefined
      ? { kind: "keyword", keyword: ability.keyword }
      : { kind: "keyword", keyword: ability.keyword, value: ability.value };
  }
  return { kind: ability.kind };
}

function normalizeExpanded(ability) {
  if (ability.kind === "static") return `static:${ability.effect.kind}`;
  return ability.kind;
}

for (const row of rows) {
  const name = row.programPath.split("/").at(-1);
  test(`RIFT-598 ${name} ${row.canonicalCardId.slice(0, 18)}: keyword-only template binding`, async () => {
    const { default: program } = await import(`../../../dist/cards/${row.programPath}.js`);
    assert.equal(program.canonicalCardId, row.canonicalCardId);
    assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
    assert.equal(program.status, "judge-required");
    if (row.sourceHasAdditionalAbility) {
      assert.ok(program.judgeReason, "unmodeled printed ability must keep an explicit judge reason");
    }
    assert.equal(validateCardProgram(program).ok, true);
    assert.deepEqual(program.abilities.map(normalizeAbility), row.abilities);
    assert.equal(typeof program.sourceText, "string");
    assert.ok(program.sourceText.length > 0);

    const binding = createProgramBinding({ cardPrograms: [program] });
    if (row.expectedExpanded.length === 0) {
      assert.throws(
        () => binding.inspect({ cardId: row.canonicalCardId, keywords: [] }),
        /Keyword unique has no executable KeywordDef/
      );
      return;
    }
    const inspected = binding.inspect({ cardId: row.canonicalCardId, keywords: [] });
    const generated = inspected.abilities.slice(program.abilities.length).map(normalizeExpanded);
    assert.deepEqual(generated, row.expectedExpanded);
    if (row.keywordOnly) {
      assert.ok(program.abilities.every(ability => ability.kind === "keyword"), "keyword-only rows must not hide another ability");
    } else {
      assert.ok(program.abilities.some(ability => ability.kind !== "keyword"), "non-keyword source must remain explicit");
      assert.equal(program.status, "judge-required");
    }
  });
}
