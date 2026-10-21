import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/frigid-touch.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const CANONICAL =
  "card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Give a unit -2 :rb_might: this turn.";

const [reaction, repeatKeyword, play] = program.abilities;
const [mightInstruction] = play.body;
const targetSpec = mightInstruction.targets[0];
const executableProgram = () => ({ ...program, status: "executable", judgeReason: undefined });

function scene({ paid, answer = () => ["first-unit"] } = {}) {
  const candidate = executableProgram();
  return productionPlay({
    programs: [candidate],
    turnPlayer: "A",
    answers: {
      [`target:${targetSpec.id}`]: (kernel) => answer(kernel).map((id) => kernel.ref(id)),
      // The optional cost request is owned by the frozen cost plan and is the
      // only Finalize question whose id contains this stable segment.
      "cost:": () => paid
    },
    build: (w) => w
      .player("A", { energy: 4, power: [] })
      .player("B", { energy: 4, power: [] })
      .hand("spell", {
        owner: "A",
        controller: "A",
        cardId: candidate.canonicalCardId,
        types: ["spell"],
        energy: 2,
        power: null
      })
      .unit("first-unit", {
        owner: "B",
        controller: "B",
        might: 6,
        location: { type: "base", player: "B" }
      })
      .unit("second-unit", {
        owner: "B",
        controller: "B",
        might: 6,
        location: { type: "base", player: "B" }
      })
      .hand("hand-unit", {
        owner: "B",
        controller: "B",
        types: ["unit"],
        might: 6,
        energy: null,
        power: null
      })
  });
}

const mightEffects = (f) => f.engine.layers.registry
  .list()
  .filter((entry) => entry.effect.effect.kind === "continuous.might");

const effectiveMight = (f, id) => f.might(id);

test("sfd-066-221 Frigid Touch: valid registered program remains judge-required for 820.2.a", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);

  assert.match(program.judgeReason, /820\.2\.a/);
  assert.match(program.judgeReason, /reselectTargets: false/);
  assert.match(program.judgeReason, /interpreter-adapter\.ts:228-239/);
  assert.match(program.judgeReason, /engine\.ts:724-766/);
  assert.doesNotMatch(program.judgeReason, /Buff counter 是无.*缺口|两处当前缺口/);
});

 test("sfd-066-221 Frigid Touch: printed keywords and the payable Repeat declaration", () => {
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(repeatKeyword, { kind: "keyword", keyword: "repeat" });

  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.payments.length, 1);
  const payment = play.cost.payments[0];
  assert.equal(payment.kind, "energy");
  assert.deepEqual(payment.amount, { kind: "constant", value: 2 });
  assert.equal(payment.choice.id, "repeat-payment");
  assert.deepEqual(payment.choice.options, ["pay", "decline"]);
  assert.equal(payment.choice.selection, "one");
});

test("sfd-066-221 Frigid Touch: the body is only the faithful Might modification", () => {
  assert.equal(play.body.length, 1);
  assert.equal(mightInstruction.id, "give-minus-2-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "affected-unit" }
  });
  assert.deepEqual(targetSpec, {
    id: "affected-unit",
    filter: { type: "unit", zone: "board" },
    selection: "one"
  });

  // A fixed count is not authored into the card. Paid-instance repetition is
  // owned by the production receipt bridge, so this card needs no effect.repeat
  // action template (and especially no Buff action as a Might substitute).
  assert.equal(play.body.some((instruction) => instruction.op === "effect.repeat"), false);
});

test("sfd-066-221 Frigid Touch production: declining Repeat pays the base 2 and executes once", () => {
  const f = scene({ paid: false });
  const draft = f.play("spell", "A");

  assert.equal(draft.speed, "reaction");
  assert.equal(f.kernel.player("A").energy, 2);
  assert.equal(f.engine.layers.registry.list().length, 1);
  assert.equal(mightEffects(f).length, 1);
  assert.equal(effectiveMight(f, "first-unit"), 4);
  assert.equal(effectiveMight(f, "second-unit"), 6);
  assert.equal(f.kernel.getObject("first-unit").buffs, 0);
  const targetRequest = f.requests.find((request) => request.id.startsWith(`target:${targetSpec.id}`));
  assert.deepEqual(targetRequest.options.map((ref) => ref.id), ["first-unit", "second-unit"]);
  assert.equal(
    f.engine.pipeline.events.filter((event) => event.timingPoint === "card-played").length,
    1,
    "CR 820.3.a: Repeat is not another play"
  );
});

test("sfd-066-221 Frigid Touch production: Reaction can be played before a pending spell resolves", () => {
  const candidate = executableProgram();
  const opener = {
    canonicalCardId: "synthetic:rift-917-reaction-opener",
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    sourceText: "[Reaction]\nDo nothing.",
    abilities: [
      { kind: "keyword", keyword: "reaction" },
      {
        kind: "play",
        cost: { kind: "cost.printed", energy: { kind: "constant", value: 1 } },
        body: []
      }
    ]
  };
  const f = productionPlay({
    programs: [candidate, opener],
    turnPlayer: "A",
    answers: {
      [`target:${targetSpec.id}`]: (kernel) => [kernel.ref("first-unit")],
      "cost:": () => false
    },
    build: (w) => w
      .player("A", { energy: 4, power: [] })
      .player("B", { energy: 4, power: [] })
      .hand("spell", {
        owner: "A",
        controller: "A",
        cardId: candidate.canonicalCardId,
        types: ["spell"],
        energy: 2,
        power: null
      })
      .hand("opener", {
        owner: "A",
        controller: "A",
        cardId: opener.canonicalCardId,
        types: ["spell"],
        energy: 1,
        power: null
      })
      .unit("first-unit", {
        owner: "B",
        controller: "B",
        might: 6,
        location: { type: "base", player: "B" }
      })
  });

  const opening = f.describe("opener", "A");
  assert.equal(opening.speed, "reaction");
  f.engine.execute(opening);
  assert.equal(f.engine.turnState, "neutral-closed");
  assert.equal(f.engine.items.length, 1);

  const response = f.describe("spell", "A");
  assert.equal(response.speed, "reaction");
  f.engine.execute(response);
  assert.equal(f.engine.items.length, 2);
  f.settle();

  assert.equal(f.kernel.player("A").energy, 1);
  assert.equal(effectiveMight(f, "first-unit"), 4);
  assert.equal(f.engine.trace.filter((entry) => entry.step === "resolved").length, 2);
});

test("sfd-066-221 Frigid Touch production: paying Repeat pays 4 total and repeats the Might effect", () => {
  const f = scene({ paid: true });
  f.play("spell", "A");

  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(mightEffects(f).length, 2);
  assert.equal(effectiveMight(f, "first-unit"), 2);
  assert.equal(effectiveMight(f, "second-unit"), 6);
  assert.equal(f.kernel.getObject("first-unit").buffs, 0);
  assert.equal(f.kernel.getObject("second-unit").buffs, 0);
  assert.equal(f.engine.pipeline.events.filter((event) => event.timingPoint === "card-played").length, 1);

  // Current production behavior confirms the remaining CR 820.2.a gap rather
  // than hiding it: the second paid execution reuses the one Finalize target.
  const targetRequests = f.requests.filter((request) => request.id.startsWith(`target:${targetSpec.id}`));
  assert.equal(targetRequests.length, 1);
});

test("sfd-066-221 Frigid Touch production: a paid target that left before Resolve is ignored", () => {
  const f = scene({ paid: true });
  f.engine.execute(f.describe("spell", "A"));
  const stale = f.kernel.ref("first-unit");
  assert.equal(f.kernel.perform({ type: "kill", object: stale }).status, "done");
  f.settle();

  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(mightEffects(f).length, 0);
  assert.equal(f.kernel.getObject("first-unit").zone, "trash");
  assert.equal(f.kernel.getObject("first-unit").buffs, 0);
  assert.equal(f.kernel.getObject("second-unit").buffs, 0);
});

test("sfd-066-221 Frigid Touch golden: the Might registration expires in the end-of-turn layer cleanup", () => {
  const kernel = world().unit("target-unit", { owner: "B", controller: "B", might: 6 }).build();
  kernel.setTargets(targetSpec.id, [kernel.ref("target-unit")]);

  const outcome = resolveChainBody([mightInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(({ id, result }) => [id, result.status]), [
    ["give-minus-2-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -2);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(layers.evaluate(kernel.ref("target-unit")).might, 4);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("target-unit")).might, 6);
  assert.equal(kernel.getObject("target-unit").buffs, 0);
});
