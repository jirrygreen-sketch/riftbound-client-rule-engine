import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/siphoning-strike.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-d47f05f65e0e87416c8e2c6dc0abce05f5a4a0bcb6855df1f6bf66a66acbaac6";
const SOURCE_TEXT =
  "Deal 4 to a unit at a battlefield. If you control 7 or more runes, deal 7 to it instead. " +
  "When it dies this turn, channel 1 rune exhausted.";
const TARGET_ID = "siphoning-strike.unit";

const [play] = program.abilities;
const [dealFour, dealSevenInstead, delayedChannel] = play.body;

const stripTargets = (instruction) => {
  const { targets, ...rest } = instruction;
  return rest;
};

/**
 * Mirrors chain/engine.ts's query normalization of "self"/"opponent" so the card's own
 * count filter (controller: "self") is what executes; nothing else is rewritten.
 */
function chainKernel(kernel) {
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
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

const runeWorld = (count) => {
  const kernel = world()
    .unit("victim", { owner: "B", controller: "B", might: 5 })
    .build();
  // The rune zone is on player A (self); 431.1 / 133.5.a.1 count the runes actually there.
  for (let index = 0; index < count; index += 1) {
    kernel.addObject(
      {
        ref: { id: "rune-" + index, zoneEntryId: 1 },
        cardId: "card:rune-" + index,
        name: "rune-" + index,
        types: ["rune"],
        tags: [],
        keywords: [],
        owner: "A",
        controller: "A",
        zone: "rune-zone",
        location: null,
        might: null,
        energy: null,
        power: null,
        exhausted: false,
        damage: 0,
        stunned: false,
        buffs: 0,
        attachedTo: null,
        faceDown: false,
        isToken: false
      },
      "rune-zone"
    );
  }
  return kernel;
};

test("ven-146-166 Siphoning Strike: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-146-166 Siphoning Strike: judgeReason names the delayed registration and the identity gap", () => {
  assert.match(program.judgeReason, /391\.2/);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-146-166 Siphoning Strike: two exclusive damage branches and the delayed channel", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["siphoning-strike.deal-4", "effect.damage"],
    ["siphoning-strike.deal-7-instead", "effect.damage"],
    ["siphoning-strike.delayed-channel", "trigger.delayed"]
  ]);

  // "Deal 4 ... If you control 7 or more runes, deal 7 to it instead": the two printed values
  // are recorded as mutually exclusive branches over the same locked target.
  assert.deepEqual(dealFour.args, {
    amount: { kind: "constant", value: 4 },
    target: { kind: "constant", value: TARGET_ID }
  });
  assert.deepEqual(dealSevenInstead.args, {
    amount: { kind: "constant", value: 7 },
    target: { kind: "constant", value: TARGET_ID }
  });
  assert.deepEqual(dealFour.condition, {
    kind: "compare",
    left: { kind: "count", subject: "runes", filter: { type: "rune", controller: "self", zone: "rune-zone" } },
    operator: "lte",
    right: { kind: "constant", value: 6 }
  });
  assert.deepEqual(dealSevenInstead.condition, {
    kind: "compare",
    left: { kind: "count", subject: "runes", filter: { type: "rune", controller: "self", zone: "rune-zone" } },
    operator: "gte",
    right: { kind: "constant", value: 7 }
  });
  assert.equal(dealSevenInstead.linkedTo, undefined);

  // "a unit at a battlefield": 355.10.b keeps the location a restriction; 355.9.a.1 makes it
  // one chosen Board unit.
  assert.deepEqual(dealFour.targets, [
    {
      id: TARGET_ID,
      filter: { type: "unit", zone: "board", location: "battlefield" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "When it dies this turn, channel 1 rune exhausted": the delayed ability the spell creates
  // (390/391.2) over the same locked unit; the merged op is still missing (judgeReason), so
  // the body is the real effect.channel the delayed trigger must run.
  assert.equal(delayedChannel.args.at.value, "object-killed");
  assert.equal(delayedChannel.args.duration.value, "this-turn");
  assert.deepEqual(delayedChannel.args.objects, { kind: "constant", value: { target: TARGET_ID } });
  assert.deepEqual(delayedChannel.args.body.value.map((instruction) => [instruction.id, instruction.op]), [
    ["siphoning-strike.channel-1", "effect.channel"]
  ]);
  assert.deepEqual(delayedChannel.args.body.value[0].args, {
    amount: { kind: "constant", value: 1 },
    exhausted: { kind: "constant", value: true }
  });

  assert.equal(instructionDefinitionsById.get("effect.damage"), damage);
  assert.equal(instructionDefinitionsById.get("effect.channel"), channel);
});

test("ven-146-166 Siphoning Strike golden: 6 runes deal exactly 4 (the 'instead' branch is false)", () => {
  const kernel = runeWorld(6);
  kernel.setTargets(TARGET_ID, [kernel.ref("victim")]);

  const outcome = resolveChainBody([stripTargets(dealFour), { ...dealSevenInstead }], chainKernel(kernel));

  assert.equal(outcome.status, "partial");
  // The second branch's condition is false, so it is skipped (contract 3.4: a condition
  // guards only its own instruction) while the 4-damage clause resolves.
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]), [
    ["siphoning-strike.deal-4", "executed", undefined],
    ["siphoning-strike.deal-7-instead", "negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("victim").damage, 4);
  assert.equal(outcome.linkedValues["siphoning-strike.deal-4.dealt"], 4);
});

test("ven-146-166 Siphoning Strike golden: 7 runes deal 7 instead (431.1 rune count)", () => {
  const kernel = runeWorld(7);
  kernel.setTargets(TARGET_ID, [kernel.ref("victim")]);

  const outcome = resolveChainBody([stripTargets(dealFour), { ...dealSevenInstead }], chainKernel(kernel));

  assert.equal(outcome.status, "partial");
  // 431.1 / 133.5.a.1: the rune-zone count is 7, so only the "instead" branch applies.
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]), [
    ["siphoning-strike.deal-4", "negated", "skipped"],
    ["siphoning-strike.deal-7-instead", "executed", undefined]
  ]);
  assert.equal(kernel.getObject("victim").damage, 7);
  assert.equal(outcome.linkedValues["siphoning-strike.deal-7-instead.dealt"], 7);
});

test("ven-146-166 Siphoning Strike golden: the delayed body's channel really channels 1 exhausted rune", () => {
  // The delayed registration itself is unmerged (judgeReason), but the body it must run is the
  // real effect.channel: one rune leaves the Rune Deck exhausted (431.1/431.2).
  const kernel = world().rune(["rune-a", "rune-b"], { owner: "A" }).build();
  const submitted = [];
  kernel.addReplacement((action) => {
    submitted.push(action);
    return null;
  });
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("rune-a") });

  const outcome = resolveChainBody(delayedChannel.args.body.value, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map((event) => event.action), ["channel-rune"]);
  assert.deepEqual(submitted.at(-1), { type: "channel-rune", player: "A", amount: 1, exhausted: true });
  assert.equal(scoped.player("A").runeDeckSize, 1);
  assert.equal(scoped.player("A").runePool.length, 1);
  assert.equal(outcome.linkedValues["siphoning-strike.channel-1.channeled"], 1);
});

test("ven-146-166 Siphoning Strike: 'at a battlefield' matches battlefields only", () => {
  const { ...filter } = dealFour.targets[0].filter;
  delete filter.type;
  delete filter.zone;
  const snapshot = (location) => ({
    ref: { id: "unit", zoneEntryId: 1 },
    cardId: "card:unit",
    name: "unit",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location,
    might: 5,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  });
  assert.equal(matchesObjectFilter(filter, snapshot({ type: "battlefield", id: "battlefield-1" })), true);
  assert.equal(matchesObjectFilter(filter, snapshot({ type: "base", player: "B" })), false);
  assert.equal(matchesObjectFilter(filter, snapshot(null)), false);
});

test("ven-146-166 Siphoning Strike: direct primitive evidence for both merged halves", () => {
  const kernel = runeWorld(7);
  const run = runInstruction(
    damage,
    {
      amount: { kind: "constant", value: 7 },
      target: TARGET_ID
    },
    { world: kernel, targets: { [TARGET_ID]: [kernel.ref("victim")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("victim").damage, 7);
  assert.deepEqual(run.events.map((event) => event.action), ["damage"]);
});

test.todo(
  "ven-146-166 Siphoning Strike: register the spell-created delayed ability \"When it dies this turn, " +
    "channel 1 rune exhausted\" (390/391.2/392) over the locked unit and align it with the object-killed " +
    "event (429.1/429.2) — needs a card-facing trigger.delayed op and the RIFT-120 registration path; " +
    "the body's effect.channel is already executable"
);

test.todo(
  "ven-146-166 Siphoning Strike: the 'instead' value replacement and the 359.3.e.14.a link semantics " +
    "between the two damage branches — needs the RIFT-90 condition/link pipeline; until then only one " +
    "of the two mutually exclusive conditions can be true"
);
