import assert from "node:assert/strict";
import test from "node:test";

import program from "../../../card-dsl/dist/cards/sfd/production-surge.js";
import { CostPlanError } from "../../dist/cost/plan-types.js";
import { previewCostPlan } from "../../dist/cost/discounts/index.js";
import { world } from "../../dist/effects/testing/index.js";

// Riftbound Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 133.3.a limits an unqualified "Mech" reference to the Board. 356.4 and
// 356.4.b apply the card's two-Energy discount, 356.6 floors each cost at zero,
// and 357.1 pays the resulting Energy and Power together. Production Surge's
// canonicalCardId is card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b.

const context = ({ mech = false, battlefieldMech = false, championMech = false, enemyMech = false } = {}) => {
  let builder = world()
    .player("A", { energy: 4, power: ["Mind"] })
    .player("B", { energy: 2 })
    .hand("surge", {
      cardId: program.canonicalCardId,
      name: "Production Surge",
      types: ["spell"],
      energy: 4,
      power: ["Mind"],
    });
  if (mech) builder = builder.base("friendly-mech", { tags: ["Mech"] });
  if (battlefieldMech) builder = builder.unit("battlefield-mech", {
    tags: ["Mech"], location: { type: "battlefield", id: "field" },
  });
  if (championMech) builder = builder.object("champion-mech", {
    types: ["unit"], tags: ["Mech"], zone: "champion",
  });
  if (enemyMech) builder = builder.base("enemy-mech", {
    owner: "B", controller: "B", tags: ["Mech"], location: { type: "base", player: "B" },
  });
  const kernel = builder.build();
  const source = kernel.getObject("surge");
  return { kernel, source, context: kernel.clone({ sourceSnapshot: source, controller: "A" }) };
};

const sources = (context, mechSource = null) => ({
  statics: program.abilities.flatMap((ability, index) => ability.kind !== "static" ? [] : [{
    id: `production-surge:${index}`,
    source: mechSource === null ? context.source.ref : context.ref(mechSource),
    ability,
  }]),
  purpose: "play",
  originZone: "hand",
});

const input = () => ({ id: "production-surge-preview", cost: { kind: "printed" } });

test("Production Surge preview keeps 4 Energy and 1 Mind when no friendly Mech is controlled", () => {
  const fixture = context({ enemyMech: true });
  const plan = previewCostPlan(fixture.context, input(), sources(fixture));
  assert.equal(plan.total.energy, 4);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Mind"] }]);
  assert.deepEqual(plan.discounts, []);
});

test("Production Surge preview reduces only Energy from 4 to 2 with a friendly Board Mech", () => {
  const fixture = context({ mech: true });
  const plan = previewCostPlan(fixture.context, input(), sources(fixture));
  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Mind"] }]);
  assert.deepEqual(plan.discounts.map(({ resource, before, after }) => [resource, before, after]),
    [["energy", 4, 2]]);
});

test("Production Surge preview counts a controlled Mech at a battlefield", () => {
  const fixture = context({ battlefieldMech: true });
  const plan = previewCostPlan(fixture.context, input(), sources(fixture));
  assert.equal(plan.total.energy, 2);
});

test("Production Surge preview does not count a Mech in the Champion Zone", () => {
  const fixture = context({ championMech: true });
  const plan = previewCostPlan(fixture.context, input(), sources(fixture));
  assert.equal(plan.total.energy, 4);
  assert.deepEqual(plan.discounts, []);
});

test("Production Surge preview does not mutate authority or open a real choice", () => {
  const fixture = context({ mech: true });
  const before = fixture.kernel.snapshot();
  previewCostPlan(fixture.context, input(), sources(fixture));
  assert.deepEqual(fixture.kernel.snapshot(), before);
});

test("cost preview fails closed instead of opening a real Finalize choice", () => {
  const fixture = context();
  const payment = fixture.kernel.clone({ sourceSnapshot: fixture.source, controller: "A" });
  const input = {
    id: "preview-choice", cost: { kind: "printed" },
    optionalAdditional: [{ id: "optional", kind: "additional", cost: { energy: { kind: "constant", value: 1 } } }],
  };
  assert.throws(() => previewCostPlan(payment, input),
    error => error instanceof CostPlanError && error.reason === "judge-required");
});
