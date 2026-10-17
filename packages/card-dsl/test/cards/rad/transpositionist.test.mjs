// Golden test for Transpositionist (rad-115-167).
// The return half, the optional wrapper and the linked-Might comparison are the
// verifiable parts; the ignored-cost plan, the dynamic "less Might" filter and the
// play location stay judge-required (see judgeReason).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/transpositionist.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-29039a01e010e05c672135f4eecdce0272b117de9fa9ef982dc8f57634cb6e6d";
const SOURCE_TEXT =
  ":rb_rune_chaos:, :rb_exhaust:: Return a friendly unit to its owner's hand. " +
  "You may play a unit with less Might than that unit had, ignoring its cost.";

const [activated] = program.abilities;
const [returnFriendly, mayPlay] = activated.body;
const [playCheaper] = mayPlay.args.body.value;
const [cheaperPick] = playCheaper.picks;

// Finalize-time selections (targets/picks metadata) are supplied to the
// reference kernel directly: its scalar filter comparison cannot resolve the
// card's symbolic "controller" spellings (same convention as the merged
// ogn/pit-rookie golden). Strip only that metadata, never the IR semantics.
const executionBody = activated.body.map(instruction => {
  if (instruction.id === "transpositionist.return-friendly") {
    const { targets, ...rest } = instruction;
    return rest;
  }
  if (instruction.id === "transpositionist.may-play") {
    return {
      ...instruction,
      args: {
        ...instruction.args,
        body: {
          ...instruction.args.body,
          value: instruction.args.body.value.map(entry => {
            const { picks, ...rest } = entry;
            return rest;
          })
        }
      }
    };
  }
  return instruction;
});

/** One ticket: a friendly unit at a battlefield plus a cheaper unit in hand. */
function ticket({ might = 4, handMight = 2, accept = true } = {}) {
  const base = world()
    .unit("friendly", { might, location: { type: "battlefield", id: "bf-1" } })
    .hand("cheaper", { types: ["unit"], might: handMight })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("friendly") });
  kernel.setTargets("transpositionist.friendly-unit", [base.ref("friendly")]);
  kernel.setPicks("transpositionist.cheaper-unit", [base.ref("cheaper")]);
  kernel.setAnswers({ "transpositionist.may-play/optional": accept });
  return kernel;
}

test("rad-115-167 Transpositionist: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-115-167 Transpositionist: judgeReason names the ignored-cost, dynamic-filter and location gaps", () => {
  assert.match(program.judgeReason, /ignoring its cost/);
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  assert.match(program.judgeReason, /355\.10\.a/);
  assert.match(program.judgeReason, /355\.2\.a/);
  assert.match(program.judgeReason, /ignoreAllCosts/);
  assert.match(program.judgeReason, /Weaponmaster/);
});

test("rad-115-167 Transpositionist: the activated ability pays one Chaos power plus exhausting this unit (145.1/377)", () => {
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.power, { kind: "constant", value: ["Chaos"] });
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust" }]);
  assert.equal(activated.restriction, undefined);
});

test("rad-115-167 Transpositionist: the first instruction returns a friendly on-board unit to its owner's hand (355.9)", () => {
  assert.equal(activated.body.length, 2);
  assert.equal(returnFriendly.id, "transpositionist.return-friendly");
  assert.equal(returnFriendly.op, "effect.zone");
  assert.deepEqual(returnFriendly.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnFriendly.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(returnFriendly.targets, [
    {
      id: "transpositionist.friendly-unit",
      filter: { type: "unit", controller: "controller", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(returnFriendly.linkedTo, undefined);
});

test("rad-115-167 Transpositionist: 'you may play a unit …' is choice.optional linked to the return (contract 3.9)", () => {
  assert.equal(mayPlay.id, "transpositionist.may-play");
  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.linkedTo, returnFriendly.id);
  assert.equal(mayPlay.args.body.kind, "constant");
  assert.deepEqual(mayPlay.args.body.value.map(entry => entry.id), [
    "transpositionist.play-cheaper"
  ]);
});

test("rad-115-167 Transpositionist: the play compares the hand card's Might with the returned unit's Might (359.3.e.13)", () => {
  assert.equal(playCheaper.op, "effect.play");
  assert.deepEqual(playCheaper.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [], xp: 0 }
  });
  assert.deepEqual(playCheaper.condition, {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { pick: "transpositionist.cheaper-unit" },
      property: "might"
    },
    operator: "lt",
    right: {
      kind: "object-property",
      object: { target: "transpositionist.friendly-unit" },
      property: "might"
    }
  });
  assert.equal(playCheaper.targets, undefined);
  assert.equal(playCheaper.picks.length, 1);
  assert.equal(cheaperPick.id, "transpositionist.cheaper-unit");
  assert.equal(cheaperPick.options[0], "dynamic:units-in-controller-hand");
  assert.deepEqual(cheaperPick.filter, {
    type: "unit",
    zone: "hand",
    owner: "controller"
  });
});

test("rad-115-167 Transpositionist: accepting returns the unit and then plays the cheaper hand unit", () => {
  const kernel = ticket({ might: 4, handMight: 2, accept: true });
  const outcome = resolveChainBody(executionBody, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [
      ["transpositionist.return-friendly", "executed"],
      ["transpositionist.play-cheaper", "executed"],
      ["transpositionist.may-play", "executed"]
    ]
  );
  assert.equal(kernel.getObject("friendly").zone, "hand");
  assert.equal(kernel.getObject("cheaper").zone, "board");
  assert.deepEqual(outcome.events.map(event => event.action), ["return-to-hand", "play"]);
});

test("rad-115-167 Transpositionist: a hand unit that is not cheaper is not played (359.3.e)", () => {
  const kernel = ticket({ might: 4, handMight: 4, accept: true });
  const outcome = resolveChainBody(executionBody, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[1].result.status, "negated");
  assert.equal(outcome.results[1].result.reason, "skipped");
  assert.equal(kernel.getObject("friendly").zone, "hand");
  assert.equal(kernel.getObject("cheaper").zone, "hand");
  assert.deepEqual(outcome.events.map(event => event.action), ["return-to-hand"]);
});

test("rad-115-167 Transpositionist: declining the optional play still returns the unit", () => {
  const kernel = ticket({ might: 4, handMight: 2, accept: false });
  const outcome = resolveChainBody(executionBody, kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[1].result.status, "negated");
  assert.equal(outcome.results[1].result.reason, "skipped");
  assert.equal(kernel.getObject("friendly").zone, "hand");
  assert.equal(kernel.getObject("cheaper").zone, "hand");
  assert.deepEqual(outcome.events.map(event => event.action), ["return-to-hand"]);
});

test.todo(
  "rad-115-167 Transpositionist: 'ignoring its cost' producing a finalized plan that clears both the base " +
    "Energy and the Power cost (CR 356.1.b.1) - cost.pay/cost.modify are merged, but the cost.modify " +
    "ignoreAllCosts path currently has only the Weaponmaster target-selector caller (cost.modify.ts header); " +
    "no play-side caller generates the " +
    "plan for a selected hand unit, and effect.play implements no ignored-cost rule itself."
);
test.todo(
  "rad-115-167 Transpositionist: 'a unit with less Might than that unit had' as a Finalize-time dynamic filter " +
    "against the returned unit's last-known Might (CR 359.3.e.13/128, 355.9.b) - the merged filters only " +
    "compare static values"
);
test.todo(
  "rad-115-167 Transpositionist: the played unit's legal location chosen at Finalize (CR 355.2.a/355.2.b) - " +
    "effect.play needs a concrete LocationRef that static IR cannot supply"
);

