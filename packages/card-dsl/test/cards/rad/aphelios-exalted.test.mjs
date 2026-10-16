import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/aphelios-exalted.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";

const CANONICAL = "card.hash-8e991cc75af9556291dd53b72f5d4d31cf399f8ee8e457c8eb20631bc18ff2d1";
const SOURCE_TEXT =
  "When you attach an Equipment to me, choose one that hasn't been chosen this turn —\n" +
  "Ready 2 runes.Channel 1 rune exhausted.[Buff] a friendly unit.";

const [triggered] = program.abilities;
const [choose] = triggered.body;
const modes = choose.args.modes.value;
const readyMode = modes.find((mode) => mode.id === "aphelios-exalted.ready-mode");
const channelMode = modes.find((mode) => mode.id === "aphelios-exalted.channel-mode");
const buffMode = modes.find((mode) => mode.id === "aphelios-exalted.buff-mode");

test("rad-179-167 Aphelios, Exalted: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-179-167 Aphelios, Exalted: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /choice\.exclusive-once-per-turn/);
  assert.match(program.judgeReason, /ChainContractBlockedError/);
  assert.match(program.judgeReason, /object-attached/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-179-167 Aphelios, Exalted: object-attached Equipment trigger owns one three-mode Choice", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-attached");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-attached",
    object: { type: "gear", tags: ["Equipment"] }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);

  assert.equal(choose.id, "aphelios-exalted.choose");
  assert.equal(choose.op, "choice.mode");
  assert.deepEqual(choose.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(choose.args.different, { kind: "constant", value: true });
  assert.deepEqual(choose.args.prompt, {
    kind: "constant",
    value: "Choose one that hasn't been chosen this turn."
  });
  assert.equal(choose.args.modes.kind, "constant");
  assert.deepEqual(modes.map((mode) => mode.id), [
    "aphelios-exalted.ready-mode",
    "aphelios-exalted.channel-mode",
    "aphelios-exalted.buff-mode"
  ]);
  assert.equal(choose.linkedTo, undefined);
});

test("rad-179-167 Aphelios, Exalted: the runes mode readies exactly 2 runes from the rune zone", () => {
  assert.equal(readyMode.body.length, 1);
  const [readyInstruction] = readyMode.body;
  assert.equal(readyInstruction.id, "aphelios-exalted.ready-2-runes");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "aphelios-exalted.runes" }
  });
  assert.deepEqual(readyInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(readyInstruction.targets, [
    {
      id: "aphelios-exalted.runes",
      filter: { type: "rune", controller: "controller", zone: "rune-zone" },
      min: 2,
      max: 2,
      selection: "any"
    }
  ]);
});

test("rad-179-167 Aphelios, Exalted: the channel mode channels 1 rune exhausted", () => {
  assert.equal(channelMode.body.length, 1);
  const [channelInstruction] = channelMode.body;
  assert.equal(channelInstruction.id, "aphelios-exalted.channel-1-exhausted");
  assert.equal(channelInstruction.op, "effect.channel");
  // CR 431.2 的示例原文就是 "Channel 1 rune exhausted."（431.2.a 默认 ready）。
  assert.deepEqual(channelInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelInstruction.args.exhausted, { kind: "constant", value: true });
});

test("rad-179-167 Aphelios, Exalted: the buff mode targets one friendly unit", () => {
  assert.equal(buffMode.body.length, 1);
  const [buffInstruction] = buffMode.body;
  assert.equal(buffInstruction.id, "aphelios-exalted.buff-friendly-unit");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffInstruction.args.target, {
    kind: "constant",
    value: "aphelios-exalted.friendly-unit"
  });
  assert.deepEqual(buffInstruction.targets, [
    {
      id: "aphelios-exalted.friendly-unit",
      filter: { type: "unit", controller: "controller", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-179-167 Aphelios, Exalted golden: effect.channel really channels the top rune exhausted", () => {
  const kernel = world().rune(["r1", "r2"]).build();
  const args = channelMode.body[0].args;
  const run = runInstruction(channel, args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.getObject("r1").zone, "rune-zone");
  assert.equal(kernel.getObject("r2").zone, "rune-deck");
  assert.deepEqual(run.events.map((event) => event.action), ["channel-rune"]);
});

test("rad-179-167 Aphelios, Exalted golden: effect.ready readies the two locked runes", () => {
  const kernel = world()
    .unit("rune-a", { types: ["rune"], zone: "rune-zone", exhausted: true })
    .unit("rune-b", { types: ["rune"], zone: "rune-zone", exhausted: true })
    .build();
  const run = runInstruction(
    ready,
    {
      objects: { kind: "constant", value: { kind: "target", id: "aphelios-exalted.runes" } },
      amount: { kind: "constant", value: 2 },
      linkKey: { kind: "constant", value: "readiedRunes" }
    },
    {
      world: kernel,
      targets: {
        "aphelios-exalted.runes": [kernel.ref("rune-a"), kernel.ref("rune-b")]
      }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("rune-a").exhausted, false);
  assert.equal(kernel.getObject("rune-b").exhausted, false);
  assert.equal(run.result.linkedValues.readiedRunes.count, 2);
  assert.deepEqual(run.events.map((event) => event.action), ["ready", "ready"]);
});

test("rad-179-167 Aphelios, Exalted golden: effect.buff places one buff counter on the friendly unit", () => {
  const kernel = world().unit("ally", { might: 2 }).build();
  const run = runInstruction(
    buff,
    { mode: "buff", target: "aphelios-exalted.friendly-unit" },
    { world: kernel, targets: { "aphelios-exalted.friendly-unit": [kernel.ref("ally")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.equal(run.linked.buffedCount, 1);
  assert.deepEqual(run.events.map((event) => event.action), ["buff"]);
});

test("rad-179-167 Aphelios, Exalted: the ops this card needs are not registered", () => {
  assert.equal(instructionDefinitionsById.get("choice.exclusive-once-per-turn"), undefined);
  assert.notEqual(instructionDefinitionsById.get("effect.ready"), undefined);
  assert.notEqual(instructionDefinitionsById.get("effect.channel"), undefined);
  assert.notEqual(instructionDefinitionsById.get("effect.buff"), undefined);
});

test.todo(
  "rad-179-167 Aphelios, Exalted: record the per-turn chosen-mode receipt so each of the three modes can be " +
    "chosen only once this turn (CR 303 / 319) — choice.exclusive-once-per-turn has no merged implementation " +
    "(no assigned task; RIFT-9 section 4 lists it for rad-179-167)"
);

test.todo(
  "rad-179-167 Aphelios, Exalted: execute a mode choice during trigger resolution — chain/engine.ts " +
    "assertFinalizationSurface throws ChainContractBlockedError for choice.mode (needs a Finalize/Resolve " +
    "choice-plan adapter, RIFT-120 follow-up)"
);

test.todo(
  "rad-179-167 Aphelios, Exalted: filter object-attached events to this unit as the attach host — " +
    "events/action-adapter.ts only carries the attached Equipment, so 'to me' is not expressible " +
    "(contract change request)"
);
