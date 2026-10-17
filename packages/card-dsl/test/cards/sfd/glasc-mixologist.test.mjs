import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/glasc-mixologist.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-49233f9871e411cf4226ae402da04bca7d8cca5f0371c84fbcf23879c16ef347";
const [keyword, deathknell] = program.abilities;
const [mayPlay] = deathknell.body;
const [playUnit] = mayPlay.args.body.value;

test("sfd-165-221 Glasc Mixologist: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /356\.1\.b/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-90/);
  // The old reason blamed the unmerged cost plan (RIFT-89); the remaining
  // wiring is the cost.printed / cost.pay batch.
  assert.doesNotMatch(program.judgeReason, /RIFT-89/);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.equal(
    program.sourceText,
    "[Deathknell] — You may play a unit with cost no more than :rb_energy_3: and no more than " +
      ":rb_rune_rainbow: from your trash, ignoring its cost. (When I die, get the effect.)"
  );
});

test("sfd-165-221 Glasc Mixologist: Deathknell keyword plus optional play-from-trash body", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknell.kind, "triggered");
  assert.equal(deathknell.trigger.at, "object-killed");
  assert.deepEqual(deathknell.trigger.filter, { self: true, cause: "kill", destination: "trash" });
  // Contract 3.9: the "you may" decision wraps the chosen instructions in body.
  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.args.body.kind, "constant");
  assert.deepEqual(mayPlay.args.body.value.map((entry) => entry.id), ["glasc-mixologist.play-unit"]);
  assert.equal(playUnit.op, "effect.play");
  assert.deepEqual(playUnit.args.target, {
    kind: "constant",
    value: "glasc-mixologist.unit-in-trash"
  });
  // The effect states no play location (355.2 / 420.3.b.1): the normal play
  // procedure chooses a valid location, so no location argument is authored.
  assert.equal(playUnit.args.location, undefined);
  // 356.1.b.1: "ignoring its cost" is a zero base Energy/Power plan.
  assert.deepEqual(playUnit.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [], xp: 0 }
  });
  assert.equal(playUnit.linkedTo, undefined);
});

test("sfd-165-221 Glasc Mixologist: trash target carries the printed-cost ceilings descriptively", () => {
  assert.equal(playUnit.targets.length, 1);
  const [target] = playUnit.targets;
  assert.equal(target.id, "glasc-mixologist.unit-in-trash");
  assert.deepEqual(target.filter, {
    zone: "trash",
    type: "unit",
    owner: "controller",
    costEnergyLte: 3,
    costPowerLte: 1
  });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("sfd-165-221 Glasc Mixologist: the merged play primitive plays the locked trash unit for a zero-cost plan", () => {
  const kernel = world().player("A").build();
  kernel.addObject(
    {
      ref: { id: "mixologist", zoneEntryId: 1 },
      cardId: "card:mixologist",
      name: "Mixologist",
      types: ["unit"],
      tags: ["Zaun"],
      keywords: [],
      owner: "A",
      controller: "A",
      zone: "trash",
      location: null,
      might: 5,
      energy: 5,
      power: ["Order"],
      exhausted: true,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false
    },
    "trash"
  );
  const run = runInstruction(
    play,
    {
      target: "glasc-mixologist.unit-in-trash",
      location: { kind: "constant", value: { type: "base", player: "A" } },
      cost: { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } },
      linkKey: "played"
    },
    {
      world: kernel,
      targets: { "glasc-mixologist.unit-in-trash": [kernel.ref("mixologist")] }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.played, 1);
  assert.equal(kernel.getObject("mixologist").zone, "board");
  assert.deepEqual(kernel.getObject("mixologist").location, { type: "base", player: "A" });
});

test.todo(
  "sfd-165-221 Glasc Mixologist: enforce the printed-cost ceiling (Energy <= 3, Power <= 1 including [A] " +
    "Universal Power, 163.2.b) and generate the ignore-cost plan from the chosen trash unit (356.1.b.1, " +
    "RIFT-90 printed-cost predicate and RIFT-261 cost.printed / cost.pay wiring)"
);

test("sfd-165-221 Glasc Mixologist: the merged Deathknell keyword is registered", () => {
  assert.equal(keywordDefinitionsById.has("Deathknell"), true);
  assert.equal(keywordDefinitionsById.get("Deathknell").stacking, "separate");
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });
});

test("sfd-165-221 Glasc Mixologist golden: the card's own optional body plays the locked trash unit on accept", () => {
  // The card's original may-play wrapper executes through the production chain
  // adapter with the caller-supplied zero-cost plan the unmerged cost.printed
  // step would otherwise build (356.1.b.1). The descriptive costEnergyLte /
  // costPowerLte keys are ignored by the reference matcher, matching the
  // judged gap (they must never be treated as a working ceiling).
  const base = world()
    .player("A")
    .card("mixologist", { types: ["unit"], owner: "A", zone: "trash", energy: 5, power: ["Order"] })
    .build();
  const query = (filter) =>
    base.objects.filter((object) =>
      matchesObjectFilter(
        Object.fromEntries(
          Object.entries(filter).map(([key, value]) => [
            key,
            (key === "controller" || key === "owner") && value === "controller" ? "A" : value
          ])
        ),
        object
      )
    );
  const kernel = bindResolveContext(base, { source: base.getObject("mixologist"), query });
  kernel.setAnswers({ "glasc-mixologist.may-play/optional": true });
  kernel.setTargets("glasc-mixologist.unit-in-trash", [base.ref("mixologist")]);

  const outcome = resolveChainBody([mayPlay], kernel);
  assert.equal(outcome.status, "executed");
  // Nested results are reported in execution order: the play step, then the
  // wrapping choice.optional.
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["glasc-mixologist.play-unit", "executed"],
    ["glasc-mixologist.may-play", "executed"]
  ]);
  assert.equal(base.getObject("mixologist").zone, "board");
});

test("sfd-165-221 Glasc Mixologist golden: declining the option leaves the trash untouched", () => {
  const kernel = world()
    .card("mixologist", { types: ["unit"], owner: "A", zone: "trash" })
    .build();
  kernel.setAnswers({ "glasc-mixologist.may-play/optional": false });
  kernel.setTargets("glasc-mixologist.unit-in-trash", [kernel.ref("mixologist")]);

  const outcome = resolveChainBody([mayPlay], kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("mixologist").zone, "trash");
});

test("sfd-165-221 Glasc Mixologist golden: a stale trash target is ignored (359.3.e.6)", () => {
  const kernel = world()
    .card("mixologist", { types: ["unit"], owner: "A", zone: "trash" })
    .build();
  const stale = kernel.ref("mixologist");
  kernel.perform({ type: "banish", object: stale });
  kernel.setAnswers({ "glasc-mixologist.may-play/optional": true });
  kernel.setTargets("glasc-mixologist.unit-in-trash", [stale]);

  const outcome = resolveChainBody([mayPlay], kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results.at(-1).result.status, "ignored");
  assert.equal(outcome.results.at(-1).result.reason, "mistargeted");
  assert.equal(kernel.getObject("mixologist").zone, "banishment");
});
