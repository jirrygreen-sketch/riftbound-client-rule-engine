import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCardProgram } from '../../dist/index.js';
import plunderingPoro from '../../dist/cards/sfd/plundering-poro.js';
import rumbleHotheaded from '../../dist/cards/sfd/rumble-hotheaded.js';
import rumbleScrapper from '../../dist/cards/sfd/rumble-scrapper.js';
import mechanizedMenace from '../../dist/cards/sfd/mechanized-menace.js';

// Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 107.4.c and 174.6 make the Champion Legend a Game Object capable of a
// Passive Ability in Legend. 108.3/365.1/366.1 keep an ordinary unit's passive
// inactive in Champion until it reaches the Board. 466.2.c.3 assigns combat
// roles; 467.2 uses current Might. 801.3.a applies granted keywords, with
// Assault 807.1.c/d.1 and Shield 814.1.b.3/c/d.1 adding Might only in the
// matching role. 478.1/478.3 continuously re-evaluate the layers.

const EVIDENCE = Object.freeze({
  ruleset: "core-1.5",
  published: "2026-10-09",
  effective: "2026-10-16",
  url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf",
  legend: "sfd-181-221",
  hero: "sfd-026-221",
  unrelatedMechBonus: "sfd-089-221",
  reportedNonMech: "sfd-069-221",
  ruleRefs: Object.freeze([
    "107.4.c", "174.6", "108.3", "365.1", "366.1", "466.2.c.3",
    "467.2", "478.1", "478.3", "801.3.a", "807.1.c", "807.1.d.1",
    "814.1.b.3", "814.1.c", "814.1.d.1",
  ]),
});

function keywordGrant(program, keyword) {
  return program.abilities.find(ability => ability.kind === "static" &&
    (ability.effect.kind === "grant-keyword" || ability.effect.kind === "continuous.grant-keyword") &&
    ability.effect.keyword.toLowerCase() === keyword.toLowerCase());
}

test("RIFT-1166 Mechanized Menace grants only Shield to controller Board Mechs", () => {
  assert.equal(validateCardProgram(mechanizedMenace).ok, true);
  assert.equal(mechanizedMenace.status, "executable");
  const grant = keywordGrant(mechanizedMenace, "Shield");
  assert.ok(grant);
  assert.deepEqual(grant.effect.filter, {
    type: "unit", tag: "Mech", controller: "controller", zone: "board",
  });
  assert.deepEqual(grant.effect.value, { kind: "constant", value: 1 });
});

test("RIFT-1166 Rumble grants Assault to controller Board Mechs", () => {
  assert.equal(validateCardProgram(rumbleHotheaded).ok, true);
  assert.equal(rumbleHotheaded.status, "executable");
  const grant = keywordGrant(rumbleHotheaded, "Assault");
  assert.ok(grant);
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.deepEqual(grant.effect.filter, {
    zone: "board", controller: "controller", tag: "Mech", type: "unit",
  });
  assert.deepEqual(grant.effect.value, { kind: "constant", value: 1 });
});

test("RIFT-1166 the separate Scrapper bonus and reported Poro are not folded into the hero grant", () => {
  assert.equal(validateCardProgram(rumbleScrapper).ok, true);
  const staticEffect = rumbleScrapper.abilities.find(ability => ability.kind === "static");
  assert.equal(staticEffect.effect.kind, "continuous.might");
  assert.equal(staticEffect.effect.keyword, undefined);
  assert.deepEqual(staticEffect.effect.value, { kind: "constant", value: 1 });
  assert.equal(plunderingPoro.canonicalCardId,
    "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82");
  assert.match(plunderingPoro.sourceText, /Gold/);
  assert.equal(rumbleHotheaded.canonicalCardId,
    "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870");
  assert.deepEqual(EVIDENCE.ruleRefs, [
    "107.4.c", "174.6", "108.3", "365.1", "366.1", "466.2.c.3",
    "467.2", "478.1", "478.3", "801.3.a", "807.1.c", "807.1.d.1",
    "814.1.b.3", "814.1.c", "814.1.d.1",
  ]);
});
