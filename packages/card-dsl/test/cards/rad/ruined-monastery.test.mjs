import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ruined-monastery.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL =
  "card.hash-71ba0d1fe11d64b565b797f33a69b572a821f2e6f56b0643eae299ca2c9a9d5d";
const SOURCE_TEXT = "When you conquer here, you may discard 1 and channel 1 rune exhausted.";

const [ability] = program.abilities;
const [choice] = ability.body;
const [discard, channel] = choice.args.body.value;
const OPTIONAL_ID = "ruined-monastery.opt-in/optional";
const DISCARD_ID =
  "ruined-monastery.opt-in/ruined-monastery.discard/ruined-monastery-discard";

test("rad-166-167 Ruined Monastery: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("rad-166-167 Ruined Monastery: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /宿主相对|host-relative/);
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-166-167 Ruined Monastery: the trigger filter is accepted by the engine trigger vocabulary", () => {
  const result = validateTriggerSpec(ability.trigger);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  // The merged pipeline maps the declared spelling onto the conquer timing point
  // that TurnFlow's Score wave really emits.
  assert.equal(
    matchesTriggerEvent(ability.trigger.filter, {
      eventId: 1,
      timingPoint: "conquer",
      player: "A",
      details: { battlefieldId: "bf-1" }
    }, "A"),
    true
  );
});

test("rad-166-167 Ruined Monastery: optional body wraps both printed actions in order", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, true);
  assert.equal(ability.trigger.at, "conquer");
  // 190.6.d "you": the conquer event's player is this ability's controller.
  // The engine's closed event spelling is "conquered" (EVENT_PATTERN_TYPES),
  // which pipeline-match maps onto the conquer timing point. The printed 053.3
  // "here" restriction has no host-relative anchor in that vocabulary and is
  // stated in judgeReason instead of being written as an unevaluable field.
  assert.deepEqual(ability.trigger.filter, {
    event: "conquered",
    player: "self"
  });
  assert.equal(ability.trigger.once, undefined);

  // Contract 3.9: "you may discard 1 and channel 1 rune exhausted" is ONE
  // optional decision; both instructions live inside the choice.optional body.
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["ruined-monastery.opt-in"]);
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.body.kind, "constant");
  assert.deepEqual(choice.args.body.value.map(instruction => instruction.id), [
    "ruined-monastery.discard",
    "ruined-monastery.channel"
  ]);
  assert.equal(choice.linkedTo, undefined);

  // 423.1/423.1.a/423.4: the discarding player chooses which card; the choice
  // is private and carries no TargetSpec.
  assert.equal(discard.op, "effect.discard");
  assert.deepEqual(discard.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(discard.args.choiceId, {
    kind: "constant",
    value: "ruined-monastery-discard"
  });
  assert.equal(discard.targets, undefined);
  assert.equal(discard.picks, undefined);

  // 431.1/431.2: channel one rune from the Rune Deck, entering exhausted.
  // The channel is not "linkedTo" the discard: accepting the printed optional
  // covers both actions, and 359.3.e.11 keeps the channel resolving as far as
  // possible when the discard itself is negated.
  assert.equal(channel.op, "effect.channel");
  assert.deepEqual(channel.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channel.args.exhausted, { kind: "constant", value: true });
  assert.equal(channel.linkedTo, undefined);
});

test("rad-166-167 Ruined Monastery: accepting discards the chosen card and channels one rune", () => {
  const kernel = world().hand("h1").hand("h2").rune(["r1", "r2"]).build();

  // Without an answer the whole body suspends; the world is untouched.
  assert.throws(
    () => resolveChainBody(ability.body, kernel),
    error => error.request?.id === OPTIONAL_ID && error.request?.type === "optional"
  );
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["h1", "h2"]);
  assert.equal(kernel.events.length, 0);

  // Answering the optional and the private discard choice replays the whole body.
  kernel.setAnswers({ [OPTIONAL_ID]: true, [DISCARD_ID]: [kernel.ref("h2")] });
  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["ruined-monastery.discard", "executed"],
    ["ruined-monastery.channel", "executed"],
    ["ruined-monastery.opt-in", "executed"]
  ]);
  // 423.1: the chosen card went to Trash; 431.1: exactly one rune left the Rune
  // Deck for the rune pool.
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["h2"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["h1"]);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["discard", "channel-rune"]);
});

test("rad-166-167 Ruined Monastery: declining the optional performs neither action", () => {
  const kernel = world().hand("h1").rune(["r1"]).build();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["ruined-monastery.opt-in", "negated"]
  ]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["h1"]);
  assert.deepEqual(kernel.zone("A", "trash"), []);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 0);
  assert.equal(kernel.events.length, 0);
});

test("rad-166-167 Ruined Monastery: an empty hand negates the discard but still channels (359.3.e.11)", () => {
  const kernel = world().rune(["r1"]).build();
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["ruined-monastery.discard", "negated"],
    ["ruined-monastery.channel", "executed"],
    ["ruined-monastery.opt-in", "executed"]
  ]);
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.deepEqual(kernel.zone("A", "trash"), []);
});

test.todo(
  "rad-166-167 Ruined Monastery: channel 1 rune exhausted really enters exhausted (431.2) — the " +
    "reference kernel passes the stipulation to the channel-rune action but does not model rune " +
    "entry state; production turn/rune state owns it"
);

test.todo(
  "rad-166-167 Ruined Monastery: the conquer trigger runs end to end (Conquer Effect → chain) " +
    "— the conquer emission is merged; what is missing is the host-relative here filter " +
    "and 190.6 Battlefield-controller resolution"
);

test("rad-166-167 Ruined Monastery: the conquer trigger really binds through the merged program registry", () => {
  // The shipped program stays judge-required; the in-memory copy proves that the
  // merged src/programs path can turn this triggered ability into a real
  // TriggerRegistration. Only the host-relative "here" filter and 190.6
  // battlefield-controller resolution are missing (see judgeReason).
  const executable = { ...program, status: "executable" };
  delete executable.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const { engine, kernel } = fixture({
    cards: [{ id: "monastery", cardId: CANONICAL, types: ["battlefield"], energy: null, power: [] }]
  });
  const board = () => engine.commit({ type: "move-zone", object: kernel.ref("monastery"), to: "board" });
  board();
  engine.pipeline.emit({ timingPoint: "object-enters-board", object: kernel.getObject("monastery") });

  const registrations = triggerRegistrations(binding.registry, kernel.getObject("monastery"));
  assert.equal(registrations.length, 1);
  const [registration] = registrations;
  assert.equal(registration.spec.at, "conquer");
  assert.equal(registration.optional, true);
  assert.deepEqual(registration.activeZones, ["board"]);
  assert.equal(registration.id.startsWith("program:monastery:"), true);

  // The registered filter matches the conquer event's controller (190.6.d
  // resolves "you" to the controller; the host-relative part is the missing gap).
  const conqueredByA = {
    eventId: 1,
    timingPoint: "conquer",
    player: "A",
    details: { battlefieldId: "bf-1" }
  };
  const conqueredByB = { ...conqueredByA, player: "B" };
  assert.equal(matchesTriggerEvent(registration.spec.filter, conqueredByA, "A"), true);
  assert.equal(matchesTriggerEvent(registration.spec.filter, conqueredByB, "A"), false);
});

