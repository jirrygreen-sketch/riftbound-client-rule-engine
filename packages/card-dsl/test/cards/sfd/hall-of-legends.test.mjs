import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/hall-of-legends.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-e4adbb3b6a16047a000e20a54481f947239754cc236a48b06ad0cebcbfd7ed57";
const BASE = { type: "base", player: "A" };
const constant = (value) => ({ kind: "constant", value });

const [ability] = program.abilities;
const [choice] = ability.body;
const [pay, readyLegend] = choice.args.body.value;
const legendSelection = readyLegend.args.objects.value;

// The ready clause is linked to hall-of-legends.pay in the program, which is
// exactly what the printed "pay to ready" structure means. The pay primitive
// itself is unmerged (RIFT-261, judgeReason), so the golden executes the ready
// clause with only that link removed — the same sub-effect execution the
// previous golden used, and the readiness is still driven by the card's own
// args/choose descriptor.
const readyHalf = [{ ...readyLegend, linkedTo: undefined }];

/**
 * The merged matcher reads player selectors (layers/filter.ts), so the golden
 * binds `self` to the ability controller exactly as the production chain does;
 * the card keeps the symbolic spelling.
 */
const productionContext = (kernel) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") {
      return (filter) => target.query({}).filter((object) => matchesObjectFilter(
        Object.fromEntries(Object.entries(filter).map(([field, value]) => [
          field,
          field === "controller" && value === "self" ? target.controller : value
        ])),
        object
      ));
    }
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

function hallWorld({ exhausted = true } = {}) {
  return world()
    .player("A", { energy: 10 })
    .player("B", { energy: 10 })
    .unit("legend-1", { owner: "A", types: ["legend"], exhausted, zone: "board", location: BASE })
    .unit("enemy-legend", { owner: "B", types: ["legend"], exhausted: true, zone: "board", location: { type: "base", player: "B" } })
    .unit("unit-1", { owner: "A", exhausted: true })
    .build();
}

test("sfd-210-221 Hall of Legends: validates, is registered and keeps identity/source text", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "When you conquer here, you may pay :rb_energy_1: to ready your legend.");
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("sfd-210-221 Hall of Legends: judgeReason names the cost.pay and here-anchor gaps", () => {
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /355\.10\.g/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-210-221 Hall of Legends: conquer trigger and optional pay → ready-your-legend structure", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquer", here: true, player: "self" });
  assert.equal(ability.optional, true);
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), [
    "hall-of-legends.pay",
    "hall-of-legends.ready"
  ]);

  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.energy, constant(1));
  assert.deepEqual(pay.args.power, constant([]));

  // 355.10.g: "your legend" does not target, so it is a resolution-time
  // non-target choose selection, not a TargetSpec.
  assert.equal(readyLegend.op, "effect.ready");
  assert.equal(readyLegend.linkedTo, "hall-of-legends.pay");
  assert.equal(readyLegend.targets, undefined);
  assert.deepEqual(legendSelection, {
    kind: "choose",
    id: "hall-of-legends.legend",
    filter: { type: "legend", controller: "self" },
    min: 1,
    max: 1
  });
});

test("sfd-210-221 Hall of Legends: the conquer filter carries the documented here placeholder", () => {
  // The printed "here" (053.3) is authored as the here placeholder; wiring it
  // to this battlefield's runtime identity is the named dependency below.
  assert.equal(ability.trigger.filter.here, true);
  assert.equal(ability.trigger.filter.player, "self");
});

test("sfd-210-221 Hall of Legends golden: the ready half readies an exhausted legend through the production adapter", () => {
  const kernel = hallWorld();
  const bound = kernel.clone({
    source: kernel.getObject("legend-1"),
    sourceSnapshot: kernel.getObject("legend-1")
  });
  // The merged choose selection asks the controller for a legend they control
  // (355.10.g); the reference kernel's choose replays the supplied answer.
  // The interpreter namespaces resolution-time choices by the execution path
  // (interpreter README's stable ids): hall-of-legends.ready/<request id>.
  bound.setAnswers({ "hall-of-legends.ready/hall-of-legends.legend": [bound.ref("legend-1")] });
  const outcome = resolveChainBody(readyHalf, productionContext(bound));

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(bound.getObject("legend-1").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
});

test("sfd-210-221 Hall of Legends golden: an already-ready legend is not readied again (416.1.c)", () => {
  const kernel = hallWorld({ exhausted: false });
  const bound = kernel.clone({
    source: kernel.getObject("legend-1"),
    sourceSnapshot: kernel.getObject("legend-1")
  });
  bound.setAnswers({ "hall-of-legends.ready/hall-of-legends.legend": [bound.ref("legend-1")] });
  const outcome = resolveChainBody(readyHalf, productionContext(bound));

  // 416.1.c: readying an already-ready object is a no-op — the primitive
  // completes without changing state (and emits no ready action).
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.events.length, 0);
  assert.equal(bound.getObject("legend-1").exhausted, false);
});

test("sfd-210-221 Hall of Legends golden: the choose filter only offers the controller's legends", () => {
  const kernel = hallWorld();
  const bound = kernel.clone({
    source: kernel.getObject("legend-1"),
    sourceSnapshot: kernel.getObject("legend-1")
  });
  const options = productionContext(bound).query(legendSelection.filter).map(object => object.ref.id);
  assert.deepEqual(options, ["legend-1"]);
});

test.todo(
  "sfd-210-221 Hall of Legends: pay the printed 1 energy inside the resolving body (204.3.a/205; 383.3.b " +
    "base-cost question) so the optional chain can really resolve — needs the cost.pay primitive (RIFT-261)"
);
test.todo(
  "sfd-210-221 Hall of Legends: anchor \"here\" to this battlefield's runtime location identity (383.4.c/053.3) " +
    "so the conquer trigger can bind and only this battlefield's conquer fires it"
);
