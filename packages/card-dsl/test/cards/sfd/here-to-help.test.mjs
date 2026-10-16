import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/here-to-help.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import playInstruction from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-783f18a4ad28b8126f59f285304bee0b93c1e76fb7a557f8e9fee60bebf1f609";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "You may play a unit from hand to a battlefield you control, reducing its cost by :rb_energy_3:.";

const [hidden, action, play] = program.abilities;
const [optional] = play.body;
const [permitted] = optional.args.body.value;
const pickSpec = permitted.picks[0];

/**
 * The reference kernel compares filter values literally; the production chain
 * query (chain/engine.ts) normalizes controller "self"/"opponent" and the
 * layer matcher (layers/filter.ts) understands location-type strings. Reproduce
 * those paths so the card's own PickSpec is what executes.
 */
function productionQuery(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") {
              kernelFilter[playerKey] = target.controller;
            } else if (normalized[playerKey] === "opponent") {
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          if (typeof normalized.location === "string") delete kernelFilter.location;
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller))
            .filter((object) => normalized.location === undefined || typeof normalized.location !== "string" ||
              (object.location !== null && object.location.type === normalized.location));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("sfd-111-221 Here to Help: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-111-221 Here to Help: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("sfd-111-221 Here to Help: judgeReason names cost.hidden, the discount producer and the Location choice", () => {
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /FinalizedCostPlan/);
  assert.match(program.judgeReason, /Location/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("sfd-111-221 Here to Help: [Hidden] + [Action] keywords and the printed cost", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
});

test("sfd-111-221 Here to Help: the optional clause wraps the permitted instruction in its body (contract 3.9)", () => {
  assert.equal(play.body.length, 1);
  assert.equal(optional.id, "here-to-help.may-play-unit");
  assert.equal(optional.op, "choice.optional");
  // The may is expressed as choice.optional wrapping the permitted
  // instruction, never as a leading choice plus a linkedTo successor.
  assert.equal(optional.linkedTo, undefined);
  assert.deepEqual(optional.args.prompt, {
    kind: "constant",
    value: "Play a unit from hand, reducing its cost by 3 energy?"
  });
  assert.equal(optional.args.body.kind, "constant");
  assert.deepEqual(optional.args.body.value.map((instruction) => instruction.id), [
    "here-to-help.play-unit"
  ]);
});

test("sfd-111-221 Here to Help: the permitted play uses a hand pick plus descriptive cost/location shapes", () => {
  assert.equal(permitted.id, "here-to-help.play-unit");
  assert.equal(permitted.op, "effect.play");
  assert.equal(permitted.linkedTo, undefined);
  // 355.10.a: a card in hand is not in a public zone, so it is a pick, not a target.
  assert.deepEqual(permitted.args.pick, { kind: "constant", value: "here-to-help.unit" });
  assert.equal(permitted.targets, undefined);
  assert.deepEqual(pickSpec, {
    id: "here-to-help.unit",
    options: ["dynamic:unit-card-in-controller-hand"],
    filter: { type: "unit", zone: "hand", owner: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // 355.4/355.4.a/451.1: "a battlefield you control" is a runtime Location
  // choice; the descriptor fails closed in effect.play (see judgeReason).
  assert.deepEqual(permitted.args.location, {
    kind: "constant",
    value: {
      kind: "destination-selector",
      filter: { type: "battlefield", controller: "self" }
    }
  });
  // 356.1.c/356.4/356.6: the printed -3 energy reduction needs a finalized
  // plan produced by the cost system; this descriptor is not one.
  assert.deepEqual(permitted.args.cost, {
    kind: "constant",
    value: {
      kind: "cost.modify",
      base: "printed",
      resource: "energy",
      amount: -3,
      minimum: 0,
      finalized: false
    }
  });
  assert.equal(instructionDefinitionsById.get("effect.play"), playInstruction);
});

test("sfd-111-221 Here to Help golden: declining the optional clause leaves the hand and the board untouched", () => {
  const kernel = world().hand("unit-card", { types: ["unit"], owner: "A" }).build();
  kernel.setPicks("here-to-help.unit", [kernel.ref("unit-card")]);
  kernel.setAnswers({ "here-to-help.may-play-unit/optional": false });
  const eventCount = kernel.events.length;

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  // Contract 3.9: declining yields negated/skipped for this node and later
  // (unlinked) instructions still run; here there are none.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.getObject("unit-card").zone, "hand");
  assert.equal(kernel.events.length, eventCount);
});

test("sfd-111-221 Here to Help golden: accepting reaches effect.play, which negates on the non-finalized cost (no silent free play)", () => {
  const kernel = world().hand("unit-card", { types: ["unit"], owner: "A" }).build();
  kernel.setPicks("here-to-help.unit", [kernel.ref("unit-card")]);
  kernel.setAnswers({ "here-to-help.may-play-unit/optional": true });

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  // effect.play requires an already-finalized FinalizedCostPlan; the
  // descriptive cost descriptor is not one, so the play fails closed instead
  // of playing the unit for free (356.1.c / 356.4 / 356.6).
  assert.equal(outcome.status, "partial");
  const played = outcome.results.find((entry) => entry.id === "here-to-help.play-unit");
  assert.equal(played.result.status, "negated");
  assert.equal(played.result.reason, "impossible");
  assert.equal(kernel.getObject("unit-card").zone, "hand");
  assert.equal(kernel.events.filter((event) => event.action === "play").length, 0);
});

test.todo(
  "sfd-111-221 Here to Help: [Hidden] needs the cost.hidden consumer — the Hide Discretionary Action, the facedown " +
    "zone and the free facedown play (CR 811.1.b / 811.1.c; RIFT-89 / RIFT-91, the keyword expansion in " +
    "effects/keywords/Hidden.ts is merged)."
);

test.todo(
  "sfd-111-221 Here to Help: the -3 energy reduction must be applied by a finalized cost plan for the played unit " +
    "(CR 356.1.c / 356.4 / 356.6; RIFT-89) — the card program cannot derive printed costs itself."
);

test.todo(
  "sfd-111-221 Here to Help: 'to a battlefield you control' needs the runtime Location choice (CR 355.4 / 355.4.a, " +
    "451.1; RIFT-90 target/location plan) because effect.play's location argument only accepts a LocationRef."
);
