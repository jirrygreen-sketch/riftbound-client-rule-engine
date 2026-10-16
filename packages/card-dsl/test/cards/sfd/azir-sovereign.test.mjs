import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/azir-sovereign.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-f83c5d61c7ea4a0d2c54ba2c2a17020893a7a3b5a90d16003fe815b2b61c5c12";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const BASE = { type: "base", player: "A" };
const MAY_ID = "azir-sovereign.may-move-tokens";
const READ_ID = "azir-sovereign.read-battlefield";
const MOVE_ID = "azir-sovereign.move-tokens";
const TARGET_ID = "azir-sovereign.token-units";

const azirWorld = () => world()
  .unit("azir", { might: 4, location: BATTLEFIELD })
  .unit("token-a", { isToken: true, might: 1, location: BASE })
  .unit("token-b", { isToken: true, might: 1, location: BASE })
  .unit("plain", { might: 2, location: BASE })
  .build();

// The ability host is the attacked unit; TestWorld captures its default source
// when the (still empty) world is built, so bind the real host reference.
const boundWorld = (kernel) => kernel.clone({
  source: kernel.ref("azir"),
  sourceSnapshot: kernel.getObject("azir")
});

const body = () => program.abilities[1].body;
const innerBody = () => body()[0].args.body.value;

// The reference test kernel's own filter matcher compares scalars by value and
// has no `type: "token"` branch, and no `controller` placeholder binding; the
// production matchers (layers/filter.ts, events/pipeline-match.ts, and
// chain/engine.ts's self/opponent normalization) own both. Bind the production
// matcher here so the golden test executes the real declared filter, exactly
// like the target pipeline does in production.
const productionContext = (kernel) => bindResolveContext(kernel, {
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, value === "controller" ? kernel.controller : value])),
    object
  ))
});

test("sfd-177-221 Azir, Sovereign: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-177-221 Azir, Sovereign: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_order: as an additional cost to have me enter ready.)\n" +
      "When I attack, you may move any number of your token units to this battlefield."
  );
});

test("sfd-177-221 Azir, Sovereign: Accelerate keyword plus an attack trigger with an optional body", () => {
  assert.equal(program.abilities.length, 2);
  const [accelerate, attack] = program.abilities;
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });

  // "When I attack" is an Attack Trigger (383.4.e) at the attack-declared timing point.
  assert.equal(attack.kind, "triggered");
  assert.equal(attack.trigger.at, "attack-declared");
  assert.deepEqual(attack.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attack.trigger.condition, undefined);
  assert.equal(attack.optional, true);
  assert.equal(body().length, 1);

  // "you may ...": the chosen instructions are wrapped in the choice body (3.9).
  const choice = body()[0];
  assert.equal(choice.id, MAY_ID);
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.prompt, { kind: "constant", value: "Move any number of your token units to this battlefield?" });
  assert.equal(choice.args.body.kind, "constant");
  assert.deepEqual(innerBody().map((instruction) => [instruction.id, instruction.op]), [
    [READ_ID, "condition.value"],
    [MOVE_ID, "effect.move"]
  ]);
});

test("sfd-177-221 Azir, Sovereign: the move reads \"this battlefield\" from the source referent and moves up to every token unit", () => {
  const [read, move] = innerBody();

  // "this battlefield" is the source's location (359.3.f.1/.2): read it at
  // resolution time rather than storing a runtime ObjectRef in static IR.
  assert.deepEqual(read.args.value, { kind: "object-property", object: "source", property: "location" });
  assert.deepEqual(read.args.key, { kind: "constant", value: "here" });

  assert.equal(move.op, "effect.move");
  assert.equal(move.linkedTo, READ_ID);
  assert.deepEqual(move.args.objects, { kind: "constant", value: { target: TARGET_ID } });
  assert.deepEqual(move.args.to, { kind: "linked-value", instructionId: READ_ID, key: "here" });
  // "any number" is bounded by the number of token units actually chosen (355.13).
  assert.equal(move.args.amount.kind, "count");
  assert.deepEqual(move.args.amount.filter, { object: { target: TARGET_ID } });

  // "your token units": a target choice (355.12) that may be zero, not a pick.
  assert.equal(move.picks, undefined);
  assert.deepEqual(move.targets, [
    {
      id: TARGET_ID,
      filter: { type: "token", controller: "controller", zone: "board" },
      min: 0,
      selection: "up-to"
    }
  ]);
});

test("sfd-177-221 Azir, Sovereign: declining the may-ability moves nothing", () => {
  const kernel = boundWorld(azirWorld());
  kernel.setAnswers({ [`${MAY_ID}/optional`]: false });
  const outcome = resolveChainBody(body(), kernel);

  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status, result.result.reason]), [
    [MAY_ID, "negated", "skipped"]
  ]);
  assert.deepEqual(kernel.events, []);
  assert.deepEqual(kernel.getObject("token-a").location, BASE);
  assert.deepEqual(kernel.getObject("token-b").location, BASE);
  assert.deepEqual(kernel.getObject("plain").location, BASE);
});

test("sfd-177-221 Azir, Sovereign: accepting moves the chosen token units to this battlefield and leaves non-tokens behind", () => {
  const kernel = boundWorld(azirWorld());
  kernel.setTargets(TARGET_ID, [kernel.ref("token-a"), kernel.ref("token-b")]);
  kernel.setAnswers({ [`${MAY_ID}/optional`]: true });
  const outcome = resolveChainBody(body(), productionContext(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    [READ_ID, "executed"],
    [MOVE_ID, "executed"],
    [MAY_ID, "executed"]
  ]);
  const readResult = outcome.results.find((result) => result.id === READ_ID);
  assert.deepEqual(readResult.result.linkedValues.here, BATTLEFIELD);
  const moveResult = outcome.results.find((result) => result.id === MOVE_ID);
  assert.deepEqual(moveResult.result.linkedValues.moved, {
    count: 2,
    objects: [kernel.ref("token-a"), kernel.ref("token-b")],
    movements: [
      { object: kernel.ref("token-a"), from: BASE, to: BATTLEFIELD },
      { object: kernel.ref("token-b"), from: BASE, to: BATTLEFIELD }
    ]
  });

  assert.deepEqual(kernel.getObject("token-a").location, BATTLEFIELD);
  assert.deepEqual(kernel.getObject("token-b").location, BATTLEFIELD);
  assert.deepEqual(kernel.getObject("plain").location, BASE);
  assert.deepEqual(kernel.events.map((event) => [event.action, event.outcome ?? "done"]), [
    ["move-location", "done"],
    ["move-location", "done"]
  ]);
  assert.equal(kernel.history({ action: "move-location" }), 2);
});

test.todo(
  "sfd-177-221 Azir, Sovereign: the attack-declared timing point must be emitted when the unit gains the " +
    "Attacker designation and delivered as a pending chain item (383.4.e.2); no module emits it today " +
    "(RIFT-33 trigger scenarios / RIFT-120)."
);
test.todo(
  "sfd-177-221 Azir, Sovereign: choosing zero token units during Finalize must leave the ability as a legal, " +
    "completed resolution (355.13) instead of the primitive-level mistargeting the moved-target selector " +
    "produces for an empty locked group; belongs to the Finalize target pipeline (RIFT-90)."
);
test.todo(
  "sfd-177-221 Azir, Sovereign: paying the optional Accelerate cost [1][Order] and the enter-ready " +
    "replacement run through the Finalize cost plan and the replacement pipeline (805 / RIFT-89)."
);
