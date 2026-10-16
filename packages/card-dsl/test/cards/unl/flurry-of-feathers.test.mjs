import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/flurry-of-feathers.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-afac76ad6c5f670cc47f942343901c50caf6df49ccf238b5f8cf9b710906eba5";
const SOURCE_TEXT =
  "[Reaction]\nChoose one —\nCounter a spell.Play four 1 :rb_might: Bird unit tokens " +
  "with [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose them with a spell " +
  "or ability.)";

const [keyword, play] = program.abilities;
const [chooseOne] = play.body;
const [counterMode, birdMode] = chooseOne.args.modes.value;
const [counterInstruction] = counterMode.body;
const [tokenInstruction] = birdMode.body;

const MODE_CHOICE_ID = "flurry-of-feathers.choose-one/mode%3A0";

test("unl-044-219 Flurry of Feathers: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-044-219 Flurry of Feathers: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /187\.7/);
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /355\.2/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-044-219 Flurry of Feathers: [Reaction] plus the printed cost and a contract-3.9 choice.mode", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  // Catalog printing: 4 energy + 2 Calm power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 },
    power: { kind: "constant", value: 2 }
  });

  // "Choose one —" is the 355.3 mode choice; each mode carries its own body.
  assert.equal(play.body.length, 1);
  assert.equal(chooseOne.op, "choice.mode");
  assert.deepEqual(chooseOne.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(chooseOne.args.different, { kind: "constant", value: true });
  assert.deepEqual(
    chooseOne.args.modes.value.map((mode) => mode.id),
    ["flurry-of-feathers.counter-mode", "flurry-of-feathers.bird-tokens-mode"]
  );
  assert.equal(chooseOne.linkedTo, undefined);
});

test("unl-044-219 Flurry of Feathers: 'Counter a spell' targets one finalized chain spell", () => {
  assert.equal(counterMode.body.length, 1);
  assert.equal(counterInstruction.op, "effect.counter");
  assert.deepEqual(counterInstruction.args, {
    target: { kind: "constant", value: "flurry-of-feathers.countered-spell" }
  });
  // 355.9.a.2: "a spell" means a finalized object on the Chain; Pending chain
  // items are excluded by the target system (contract 3.4), and 355.9.c keeps
  // the card from countering itself.
  assert.deepEqual(counterInstruction.targets, [
    {
      id: "flurry-of-feathers.countered-spell",
      filter: { type: "spell", zone: "chain" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(instructionDefinitionsById.get("effect.counter"), counter);
});

test("unl-044-219 Flurry of Feathers: the Bird-token mode keeps 187.7's definition and the runtime location", () => {
  assert.equal(birdMode.body.length, 1);
  assert.equal(tokenInstruction.op, "effect.token");
  // 187.7: a 1 Might, domainless Bird unit token with the [Deflect] keyword.
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "bird" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 4 });
  // 440.2.c / 185.2.a: "Play … token" creates the token on the Chain and hands
  // it to the play flow.
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  // 355.2 / 355.2.a: the entry location is chosen at Finalize; the card keeps a
  // descriptive marker because no runtime Location selector is merged.
  assert.equal(tokenInstruction.args.location.value.kind, "location-selector");
  assert.deepEqual(tokenInstruction.args.linkKey, { kind: "constant", value: "birdTokens" });
  assert.equal(instructionDefinitionsById.get("effect.token"), token);
});

test("unl-044-219 Flurry of Feathers golden: the counter mode removes a locked chain spell (CR 426.1-426.3)", () => {
  const kernel = world()
    .object("enemy-spell", {
      zone: "chain",
      owner: "B",
      controller: "B",
      types: ["spell"]
    })
    .build();
  kernel.setTargets("flurry-of-feathers.countered-spell", [kernel.ref("enemy-spell")]);
  kernel.setAnswers({ [MODE_CHOICE_ID]: "flurry-of-feathers.counter-mode" });

  const outcome = resolveChainBody([chooseOne], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["flurry-of-feathers.counter-spell", "executed"],
      ["flurry-of-feathers.choose-one", "executed"]
    ]
  );
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.deepEqual(outcome.events.map((event) => event.action), ["counter"]);
  assert.equal(
    outcome.linkedValues["flurry-of-feathers.choose-one/flurry-of-feathers.counter-mode/0/flurry-of-feathers.counter-spell.countered"],
    1
  );
});

test("unl-044-219 Flurry of Feathers fail-closed: the authored destination is a marker, never a fabricated LocationRef", () => {
  const kernel = world().build();
  // The card deliberately does not pin a location: a descriptive marker is not
  // a legal LocationRef, so the merged effect.token negates the instruction
  // instead of putting the tokens somewhere the printed text never named
  // (355.2 / 355.2.a). No unit is created and no event is produced.
  const outcome = resolveChainBody(birdMode.body, kernel);
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [["flurry-of-feathers.play-bird-tokens", "negated", "impossible"]]
  );
  assert.deepEqual(kernel.objects.map((object) => object.ref.id), []);
  assert.deepEqual(kernel.objectsInZone("A", "board"), []);
  assert.deepEqual(outcome.events, []);
  // The authored destination stays descriptive data, not a LocationRef.
  assert.equal(tokenInstruction.args.location.value.kind, "location-selector");
  assert.equal(tokenInstruction.args.location.value.type, undefined);
});

test.todo(
  "unl-044-219 Flurry of Feathers: the 187.7 Bird token definition (domainless, 1 Might, Bird tag, " +
    "[Deflect]) must be added to effect.token's definition table together with the Deflect keyword " +
    "expansion (CR 809) — the primitive deliberately blocks definitions that carry abilities"
);

test.todo(
  "unl-044-219 Flurry of Feathers: the tokens' entry location is the runtime Location choice of " +
    "355.2 / 355.2.a / 440.2.b.1; no runtime Location selector is merged (RIFT-90), so the card keeps " +
    "a descriptive marker and today's play path is blocked rather than pinning a wrong location"
);

test.todo(
  "unl-044-219 Flurry of Feathers: [Reaction] (CR 813) needs the continuous.timing consumer and chain " +
    "canAct wiring (RIFT-85 / RIFT-91) to be playable at Closed State — declared only, like the merged " +
    "ogn/consult-the-past"
);
