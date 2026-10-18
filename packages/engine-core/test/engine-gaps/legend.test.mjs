import assert from "node:assert/strict";
import test from "node:test";

import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import createLegend from "../../dist/effects/instructions/effect.create-legend.js";
import { world } from "../../dist/effects/testing/index.js";
import { LegendZone } from "../../dist/game/legend-zone.js";
import {
  validateDeckbuilding
} from "../../dist/deck/index.js";

const constant = value => ({ kind: "constant", value });

const candidate = (cardId, name, extra = {}) => ({
  cardId,
  name,
  cardType: "Legend",
  types: ["legend"],
  energy: null,
  power: null,
  ...extra
});

function sourceContext({ sourceZone = "board", answers = {}, additionalLegends } = {}) {
  const base = world().unit("neeko", {
    cardId: "rad-neeko-blending-in",
    name: "Neeko",
    zone: sourceZone
  }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("neeko") });
  kernel.setAnswers(answers);
  const zone = new LegendZone();
  Object.assign(kernel, {
    legendZone: zone,
    additionalLegends: () => additionalLegends ?? []
  });
  return { kernel, zone };
}

function createArgs(overrides = {}) {
  return Object.fromEntries(Object.entries({
    from: constant("deckbuilding:additional-legends"),
    choiceId: constant("legend-choice"),
    duration: constant("while-source-in-zone"),
    linkKey: constant("created"),
    ...overrides
  }).filter(([, value]) => value !== undefined));
}

test("Neeko's original IR primitive chooses one additional Legend and preserves null costs", () => {
  const alpha = candidate("legend-alpha", "Alpha", { might: 4 });
  const beta = candidate("legend-beta", "Beta", { might: 5 });
  const { kernel, zone } = sourceContext({
    answers: { "legend-choice": beta },
    additionalLegends: [alpha, beta]
  });

  const result = createLegend.execute(kernel, createLegend.argsSchema.parse(createArgs()));
  assert.equal(result.status, "executed");
  assert.equal(result.linkedValues.amount, 1);
  assert.equal(zone.entries().length, 1);
  const entry = zone.entries()[0];
  assert.equal(entry.name, "Beta");
  assert.equal(entry.snapshot.energy, null);
  assert.equal(entry.snapshot.power, null);
  assert.equal(entry.snapshot.zone, "legend-zone");
});

test("a missing answer is an AwaitChoice and an invalid answer is rejected", () => {
  const alpha = candidate("legend-alpha", "Alpha");
  const beta = candidate("legend-beta", "Beta");
  const missing = sourceContext({ additionalLegends: [alpha, beta] });
  assert.throws(
    () => createLegend.execute(missing.kernel, createLegend.argsSchema.parse(createArgs())),
    error => error?.name === "AwaitChoice" && error.request.id === "legend-choice"
  );

  const invalid = sourceContext({
    answers: { "legend-choice": candidate("legend-outside", "Outside") },
    additionalLegends: [alpha, beta]
  });
  const result = createLegend.execute(invalid.kernel, createLegend.argsSchema.parse(createArgs()));
  assert.equal(result.status, "negated");
  assert.equal(invalid.zone.entries().length, 0);
});

test("an illegal destination and an off-board source are stable blocked outcomes", () => {
  const alpha = candidate("legend-alpha", "Alpha");
  const destination = sourceContext({ additionalLegends: [alpha] });
  const destinationResult = createLegend.execute(destination.kernel, createLegend.argsSchema.parse(createArgs({
    choiceId: undefined,
    to: constant("board")
  })));
  assert.equal(destinationResult.status, "negated");
  assert.equal(destinationResult.reason, "impossible");
  assert.equal(destination.zone.entries().length, 0);

  const offBoard = sourceContext({ sourceZone: "hand", additionalLegends: [alpha] });
  const offBoardResult = createLegend.execute(offBoard.kernel, createLegend.argsSchema.parse(createArgs({ choiceId: undefined })));
  assert.equal(offBoardResult.status, "negated");
  assert.equal(offBoard.zone.entries().length, 0);
});

test("a failed second creation rolls back the first creation", () => {
  const good = candidate("legend-good", "Good");
  const bad = candidate("legend-bad", "Bad", { cardType: "Unit" });
  const { kernel, zone } = sourceContext({ additionalLegends: [good, bad] });
  const result = createLegend.execute(kernel, createLegend.argsSchema.parse(createArgs({
    count: constant(2),
    choiceId: undefined
  })));
  assert.equal(result.status, "negated");
  assert.equal(result.reason, "impossible");
  assert.equal(zone.entries().length, 0);
});

test("while-source-in-zone Legends are removed on source departure, permanent ones remain", () => {
  const alpha = candidate("legend-alpha", "Alpha");
  const permanent = sourceContext({ additionalLegends: [alpha] });
  const permanentResult = createLegend.execute(permanent.kernel, createLegend.argsSchema.parse(createArgs({
    duration: constant("permanent"),
    choiceId: undefined
  })));
  assert.equal(permanentResult.status, "executed");
  permanent.zone.removeForSource(permanent.kernel.source.ref);
  assert.equal(permanent.zone.entries().length, 1);

  const bound = sourceContext({ additionalLegends: [alpha] });
  const boundResult = createLegend.execute(bound.kernel, createLegend.argsSchema.parse(createArgs({ choiceId: undefined })));
  assert.equal(boundResult.status, "executed");
  assert.equal(bound.zone.forSource(bound.kernel.source.ref).length, 1);
  const removed = bound.zone.removeForSource(bound.kernel.source.ref);
  assert.equal(removed.length, 1);
  assert.equal(bound.zone.entries().length, 0);
});

test("default chain assembly fails closed until the Legend Zone port is part of the contract", () => {
  const { kernel } = sourceContext({
    answers: { "legend-choice": candidate("legend-alpha", "Alpha") },
    additionalLegends: [candidate("legend-alpha", "Alpha")]
  });
  const body = [{
    id: "create-legend",
    op: "effect.create-legend",
    args: createArgs()
  }];
  const execution = resolveChainBody(body, kernel);
  assert.equal(execution.results[0].result.status, "negated");
  assert.equal(kernel.legendZone.entries().length, 0);
});

const catalog = [
  { id: "neeko-print", canonicalCardId: "neeko", name: "Neeko", cardType: "Unit" },
  { id: "legend-start", canonicalCardId: "legend-start", name: "Starting Legend", cardType: "Legend" },
  { id: "legend-a", canonicalCardId: "legend-a", name: "Alpha", cardType: "Legend" },
  { id: "legend-b", canonicalCardId: "legend-b", name: "Beta", cardType: "Legend" },
  { id: "legend-c", canonicalCardId: "legend-c", name: "Gamma", cardType: "Legend" },
  { id: "spider-print", canonicalCardId: "spider", name: "Spiderling", cardType: "Unit" },
  { id: "unique-print", canonicalCardId: "unique", name: "Forgefire Cape", cardType: "Gear" }
];

const neeko = {
  canonicalCardId: "neeko",
  deckbuilding: [{ kind: "choose-additional-legends", count: 3 }],
  abilities: []
};
const spiderling = {
  canonicalCardId: "spider",
  deckbuilding: [{ kind: "unlimited-copies-of-this-name" }],
  abilities: []
};
const unique = {
  canonicalCardId: "unique",
  abilities: [{ kind: "keyword", keyword: "unique" }]
};

test("deck construction consumes Neeko, Spiderling, and Unique decisions from catalog identities", () => {
  const valid = validateDeckbuilding({
    mainDeck: [
      { cardId: "neeko-print", quantity: 1 },
      { cardId: "spider-print", quantity: 4 },
      { cardId: "unique-print", quantity: 1 }
    ],
    legend: { cardId: "legend-start", quantity: 1 },
    additionalLegends: [
      { cardId: "legend-a" },
      { cardId: "legend-b" },
      { cardId: "legend-c" }
    ]
  }, { programs: [neeko, spiderling, unique], catalog });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.rules.unlimitedNames, ["spiderling"]);
  assert.deepEqual(valid.rules.uniqueNames, ["forgefire cape"]);
  assert.equal(valid.copyCounts.spider, 4);

  const invalidUnique = validateDeckbuilding({
    mainDeck: [{ cardId: "unique-print", quantity: 2 }]
  }, { programs: [unique], catalog });
  assert.equal(invalidUnique.valid, false);
  assert.ok(invalidUnique.issues.some(issue => issue.code === "unique-copy-limit-exceeded"));
});

test("additional Legends must be exactly three, distinct by name, and exclude the starting Legend", () => {
  const result = validateDeckbuilding({
    mainDeck: [{ cardId: "neeko-print", quantity: 1 }],
    legend: { cardId: "legend-start", quantity: 1 },
    additionalLegends: [
      { cardId: "legend-a" },
      { cardId: "legend-a" },
      { cardId: "legend-start" }
    ]
  }, { programs: [neeko], catalog });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.code === "additional-legend-duplicate-name"));
  assert.ok(result.issues.some(issue => issue.code === "additional-legend-matches-starting"));
});

test("printed null characteristics remain null in the Legend Zone snapshot", () => {
  const { kernel, zone } = sourceContext({
    additionalLegends: [candidate("legend-null", "Null Legend", { energy: null, power: null })]
  });
  const result = createLegend.execute(kernel, createLegend.argsSchema.parse(createArgs({ choiceId: undefined })));
  assert.equal(result.status, "executed");
  assert.equal(zone.entries()[0].snapshot.energy, null);
  assert.equal(zone.entries()[0].snapshot.power, null);
});
