import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/clash-of-giants.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-a16acd4fee0dfec2b4646c11865b24e416113a307ddab35294168618aa9d4856";
const SOURCE_TEXT =
  "Choose two units. They deal damage equal to their Mights to each other.";

const [play] = program.abilities;
const [firstDeals, secondDeals] = play.body;
const firstSpec = firstDeals.targets[0];
const secondSpec = firstDeals.targets[1];

// The reference kernel compares filter placeholders literally, so target
// identities are bound through setTargets/Finalize. TargetSpecs are asserted
// structurally above and stripped for execution (the one-two-punch /
// gentlemens-duel convention).
const executableBody = play.body.map(({ targets, ...rest }) => rest);

test("unl-110-219 Clash of Giants: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-110-219 Clash of Giants: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-110-219 Clash of Giants: printed 6 energy + 2 power and two Deal instructions", () => {
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 6 },
    power: { kind: "constant", value: 2 }
  });
  // The spell prints no speed keyword, so none is declared (159.2.a keeps the
  // default Action timing); there is no other ability on this card.
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["clash-of-giants.first-unit-deals", "effect.damage"],
      ["clash-of-giants.second-unit-deals", "effect.damage"]
    ]
  );
});

test("unl-110-219 Clash of Giants: both units are chosen at Finalize as distinct units", () => {
  // 355.5 / 355.8: both choices happen while the spell is finalized, so the
  // first instruction carries both TargetSpecs and the second re-uses them.
  assert.deepEqual(firstSpec, {
    id: "clash-of-giants.first-unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(secondSpec, {
    id: "clash-of-giants.second-unit",
    filter: {
      type: "unit",
      zone: "board",
      exclude: { target: "clash-of-giants.first-unit" }
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(secondDeals.targets, undefined);
});

test("unl-110-219 Clash of Giants: each unit is the source and the Might reader of its own Deal", () => {
  // 418.6.b.3: the damage is dealt by the chosen units, not by the spell;
  // 359.3.f.2 / contract 3.6: the amount is read when the instruction runs.
  assert.deepEqual(firstDeals.args.amount, {
    kind: "object-property",
    object: { target: "clash-of-giants.first-unit" },
    property: "might"
  });
  assert.deepEqual(firstDeals.args.source, {
    kind: "object-property",
    object: { target: "clash-of-giants.first-unit" },
    property: "ref"
  });
  assert.deepEqual(firstDeals.args.target, {
    kind: "constant",
    value: "clash-of-giants.second-unit"
  });

  assert.deepEqual(secondDeals.args.amount, {
    kind: "object-property",
    object: { target: "clash-of-giants.second-unit" },
    property: "might"
  });
  assert.deepEqual(secondDeals.args.source, {
    kind: "object-property",
    object: { target: "clash-of-giants.second-unit" },
    property: "ref"
  });
  assert.deepEqual(secondDeals.args.target, {
    kind: "constant",
    value: "clash-of-giants.first-unit"
  });

  // The two Deals are independent directions reading their own unit: neither
  // references the other's result, so neither is linked (359.3.e.14).
  assert.equal(firstDeals.linkedTo, undefined);
  assert.equal(secondDeals.linkedTo, undefined);
  // This is not 355.14 split damage: each Deal has its own fixed amount, so
  // `divide` and `combat` stay undeclared (418.6.c is combat-step damage).
  assert.equal(firstDeals.args.divide, undefined);
  assert.equal(firstDeals.args.combat, undefined);
});

test("unl-110-219 Clash of Giants golden: the chosen units damage each other by their Mights", () => {
  const kernel = world()
    .unit("first", { owner: "A", might: 3 })
    .unit("second", { owner: "B", might: 5 })
    .build();
  kernel.setTargets(firstSpec.id, [kernel.ref("first")]);
  kernel.setTargets(secondSpec.id, [kernel.ref("second")]);
  const submitted = [];
  kernel.addReplacement((action) => {
    if (action.type === "damage") submitted.push(action);
    return null;
  });

  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => entry.result.status),
    ["executed", "executed"]
  );
  // 418.1.b/.c: damage is marked separately; both units are still on the Board
  // because the cleanup that kills a lethally damaged unit runs later (320/321).
  assert.equal(kernel.getObject("first").damage, 5);
  assert.equal(kernel.getObject("second").damage, 3);
  // 418.6.b.3: each unit is its own Deal's source.
  assert.deepEqual(
    submitted.map((action) => [action.source.id, action.target.id, action.amount]),
    [
      ["first", "second", 3],
      ["second", "first", 5]
    ]
  );
  assert.deepEqual(outcome.results[0].result.linkedValues.dealtTo, [
    { target: kernel.ref("second"), amount: 3 }
  ]);
  assert.deepEqual(outcome.results[1].result.linkedValues.dealtTo, [
    { target: kernel.ref("first"), amount: 5 }
  ]);
});

test("unl-110-219 Clash of Giants golden: a zero-Might unit deals no Valid Damage (418.1.e/.e.1)", () => {
  const kernel = world()
    .unit("first", { owner: "A", might: 0 })
    .unit("second", { owner: "B", might: 4 })
    .build();
  kernel.setTargets(firstSpec.id, [kernel.ref("first")]);
  kernel.setTargets(secondSpec.id, [kernel.ref("second")]);

  const outcome = resolveChainBody(executableBody, kernel);

  // No positive amount was available for the first direction, so that Deal is
  // negated as impossible; the second direction is independent and still runs.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, {
    status: "negated",
    reason: "impossible",
    events: []
  });
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(kernel.getObject("first").damage, 4);
  assert.equal(kernel.getObject("second").damage, 0);
});

test("unl-110-219 Clash of Giants golden: a stale second unit ignores its own Deal and the source read", () => {
  const kernel = world()
    .unit("first", { owner: "A", might: 3 })
    .unit("second", { owner: "B", might: 4 })
    .build();
  const stale = kernel.ref("second");
  // The unit changes zones after finalization (359.3.e.7/.12): the reference is
  // invalid and no last-known Might is substituted.
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "hand" }).status, "done");
  kernel.setTargets(firstSpec.id, [kernel.ref("first")]);
  kernel.setTargets(secondSpec.id, [stale]);

  const outcome = resolveChainBody(executableBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => entry.result),
    [
      { status: "ignored", reason: "mistargeted" },
      { status: "ignored", reason: "mistargeted" }
    ]
  );
  assert.equal(kernel.getObject("first").damage, 0);
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "Clash of Giants: Finalize-time targeting of two distinct units plus the became-target events (355.5/355.8, 754) " +
    "belong to the target system and chain (RIFT-90/RIFT-120)"
);

test.todo(
  "Clash of Giants: the base cost payment (6 energy + 2 Body power, 356.1.c/204.1) and the Cleanup that kills a " +
    "lethally damaged unit (320/321, 323.4) belong to the cost plan and the kernel"
);

test.todo(
  "Clash of Giants: an intervening temporary Might change must be visible to the amount read at resolution " +
    "(359.3.f.2 / contract 3.6) — the reference kernel has no Might-modification action to set it up, so the read " +
    "order is asserted structurally and stays TODO until the continuous.might instruction lands (RIFT-91)"
);
