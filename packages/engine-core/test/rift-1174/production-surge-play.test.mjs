import assert from "node:assert/strict";
import test from "node:test";

import program from "../../../card-dsl/dist/cards/sfd/production-surge.js";
import { productionPlay } from "../../../card-dsl/test/fixtures/production-play.mjs";

// Riftbound Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Rules: 133.3.a, 356.4, 356.4.b, 356.6, 357.1.
// Production Surge canonicalCardId:
// card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b

function game({ friendlyMech }) {
  return productionPlay({
    programs: [program],
    build: world => {
      let built = world.player("A", { energy: 4, power: [] }).player("B", { energy: 2 })
        .hand("surge", {
          cardId: program.canonicalCardId,
          name: "Production Surge",
          types: ["spell"],
          energy: 4,
          power: [],
        })
        .deck("next-card");
      if (friendlyMech) built = built.base("friendly-mech", {
        tags: ["Mech"], might: 2,
      });
      return built;
    },
  });
}

function playAndInspect(fixture) {
  fixture.engine.execute(fixture.describe("surge"));
  const [item] = fixture.engine.items;
  assert.ok(item?.costPlan);
  assert.ok(item?.payment);
  assert.equal(item.status, "finalized");
  return item;
}

test("production play without a controlled Mech pays the printed 4 Energy", () => {
  const fixture = game({ friendlyMech: false });
  const item = playAndInspect(fixture);
  assert.equal(item.costPlan.printed.energy, 4);
  assert.equal(item.costPlan.total.energy, 4);
  assert.deepEqual(item.costPlan.discounts, []);
  assert.equal(item.payment.total.energy, 4);
  assert.equal(fixture.kernel.player("A").energy, 0);
  fixture.settle();
});

test("production play with a controlled Board Mech pays 2 Energy", () => {
  const fixture = game({ friendlyMech: true });
  const item = playAndInspect(fixture);
  assert.equal(item.costPlan.printed.energy, 4);
  assert.equal(item.costPlan.total.energy, 2);
  assert.deepEqual(item.costPlan.discounts.map(({ resource, before, after }) =>
    [resource, before, after]), [["energy", 4, 2]]);
  assert.equal(item.payment.total.energy, 2);
  assert.equal(fixture.kernel.player("A").energy, 2);
  fixture.settle();
});
