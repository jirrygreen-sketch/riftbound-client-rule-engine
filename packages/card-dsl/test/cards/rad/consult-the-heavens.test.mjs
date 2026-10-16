// Golden test for Consult the Heavens (rad-025-167).
//
// judge-required (see the program's judgeReason): granting [Shield 2] to
// another unit for the turn has no layer consumer. The runnable evidence is
// the merged [Predict] half — effect.inspect (look + optional select) then
// effect.recycle — plus the declared grant shape.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/consult-the-heavens.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-9ce83ec71d8426d676f633ef7afbd7cd6b50566fd1e1404050adaf4c506e0faf";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a unit [Shield 2] this turn. (+2 :rb_might: while it's a defender.)\n" +
  "[Predict]. (Look at the top card of your Main Deck. You may recycle it.)";

const [reaction, play] = program.abilities;
const [grantShield, predictLook, predictRecycle] = play.body;

test("rad-025-167 Consult the Heavens: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-025-167 Consult the Heavens: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: the reason names the missing grant consumer and the owner task.
  assert.match(program.judgeReason, /continuous\.keyword/);
  assert.match(program.judgeReason, /814\.1\.d\.1/);
  assert.match(program.judgeReason, /RIFT-91/);
  // The reported catalog data issue is recorded in the program header, not by
  // rewriting the text: this printing is catalogued as a Unit with no Might.
  assert.match(program.judgeReason, /cardType Unit/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-025-167 Consult the Heavens: [Reaction] plus a play body of grant + Predict", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => instruction.op),
    ["continuous.grant-keyword", "effect.inspect", "effect.recycle"]
  );
  // CR 813.1.c: Reaction is the closed-state permission keyword.
  assert.ok(shield.ruleRefs.includes("814.1.c"));
});

test("rad-025-167 Consult the Heavens: the [Shield 2] grant names a unit, a value and a turn duration", () => {
  assert.equal(grantShield.op, "continuous.grant-keyword");
  assert.deepEqual(grantShield.args.keyword, { kind: "constant", value: "shield" });
  // CR 814.1.b.1/.b.2: the printed Shield Value is 2.
  assert.deepEqual(grantShield.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(grantShield.args.duration, { kind: "constant", value: "end-of-turn" });
  // CR 355.7/355.10.b: "a unit" is chosen, so it is a target.
  assert.equal(grantShield.targets.length, 1);
  const [target] = grantShield.targets;
  assert.equal(target.id, "consult-the-heavens.unit");
  assert.deepEqual(target.filter, { type: "unit", zone: "board" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  // The keyword registry has the Shield definition; the missing piece is the
  // grant/registration consumer, not the keyword itself.
  assert.equal(keywordDefinitionsById.get("Shield"), shield);
});

test("rad-025-167 Consult the Heavens: the [Predict] steps use the merged inspect + recycle primitives", () => {
  assert.equal(predictLook.op, "effect.inspect");
  // CR 437.3.a: Predict without a number looks at one card.
  assert.deepEqual(predictLook.picks[0].min, 0);
  assert.deepEqual(predictLook.picks[0].max, 1);
  assert.deepEqual(predictLook.args.choose, { kind: "constant", value: true });
  assert.deepEqual(predictLook.args.chooseCount, {
    kind: "constant",
    value: { min: 0, max: 1 }
  });
  assert.equal(predictRecycle.op, "effect.recycle");
  assert.equal(predictRecycle.linkedTo, "consult-the-heavens.predict-look");
  assert.deepEqual(predictRecycle.args.objects, {
    kind: "linked",
    instructionId: "consult-the-heavens.predict-look",
    key: "consult-the-heavens.recycle"
  });
});

test("rad-025-167 Consult the Heavens: Predict really looks at the top card and recycles it on request", () => {
  // .deck([...]) adds an ordered block above the existing cards, so the second
  // call supplies the top (top-seen) and the first the card beneath it (rest).
  const kernel = world().hand("consult").deck(["rest"]).deck(["top-seen"]).build();
  const top = kernel.zone("A", "deck")[0];
  // The declared inspect player is the symbolic "controller" placeholder; the
  // acting player is substituted here (the same convention the merged
  // callers use, since ResolveContext carries concrete PlayerIds).
  const args = { ...predictLook.args, player: { kind: "constant", value: "A" } };
  assert.deepEqual(predictLook.args.player, { kind: "constant", value: "controller" });
  const looks = runInstruction(
    inspect,
    args,
    {
      world: kernel,
      picks: { "consult-the-heavens.predicted": [top] },
      answers: { "consult-the-heavens.predict": [top] }
    }
  );
  assert.equal(looks.result.status, "executed");
  // CR 437.1: exactly one card was looked at, and the chosen one is the recycle candidate.
  assert.equal(looks.linked.inspected, 1);
  assert.deepEqual(looks.linked["consult-the-heavens.predicted"], [top]);
  assert.deepEqual(looks.linked["consult-the-heavens.recycle"], [top]);

  const recycled = runInstruction(
    recycle,
    { objects: { kind: "constant", value: looks.linked["consult-the-heavens.recycle"] } },
    { world: kernel }
  );
  assert.equal(recycled.result.status, "executed");
  // CR 417.1.c: the recycled card goes to the bottom of its owner's Main Deck.
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["rest", "top-seen"]);
});

test("rad-025-167 Consult the Heavens: declining to recycle leaves the deck untouched", () => {
  const kernel = world().hand("consult").deck(["rest"]).deck(["top-seen"]).build();
  const top = kernel.zone("A", "deck")[0];
  const looks = runInstruction(
    inspect,
    { ...predictLook.args, player: { kind: "constant", value: "A" } },
    {
      world: kernel,
      picks: { "consult-the-heavens.predicted": [top] },
      answers: { "consult-the-heavens.predict": [] }
    }
  );
  assert.equal(looks.result.status, "executed");
  assert.deepEqual(looks.linked["consult-the-heavens.recycle"], []);
  const recycled = runInstruction(
    recycle,
    { objects: { kind: "constant", value: looks.linked["consult-the-heavens.recycle"] } },
    { world: kernel }
  );
  // CR 055 / 437.1: choosing not to recycle performs nothing (zero cards moved)
  // and the card stays on top of the deck.
  assert.equal(recycled.result.status, "executed");
  assert.equal(recycled.linked.recycledCount, 0);
  assert.deepEqual(recycled.linked.recycled, []);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["top-seen", "rest"]);
});

test.todo(
  "Consult the Heavens: 'Give a unit [Shield 2] this turn' — blocked because no merged primitive or layer consumer grants a " +
    "keyword to another object with an end-of-turn duration (continuous.keyword is unimplemented; RIFT-91), and CR 814.1.d.1's " +
    "Defender designation is not an ObjectSnapshot characteristic (contract 3.8)"
);

test.todo(
  "Consult the Heavens: reading the top card of the Main Deck inside the resolving ability requires the upstream ordered picks " +
    "(contract 3.6 zoneSlice); the golden supplies the top reference directly, which a production chain run must do (RIFT-66 wiring)"
);

test.todo(
  "Consult the Heavens: data issue (not changed) — the local catalog records printing rad-025-167 as cardType Unit with energy 1 / " +
    "power null / might null while its text is spell-shaped ([Reaction]/[Predict]), unlike the sibling rad-034-167 Hunker Down (Spell)"
);
