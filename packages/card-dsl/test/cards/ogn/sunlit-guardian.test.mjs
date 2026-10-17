import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/sunlit-guardian.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL =
  "card.hash-0386094f508d9cbd2f5fca31e0757380fa1c42cf0e9124b48b8a32d75b9fddc4";
const SOURCE_TEXT =
  "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
  "[Tank] (I must be assigned combat damage first.)";

test("ogn-054-298 Sunlit Guardian: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ogn-054-298 Sunlit Guardian: identity, ruleset, status, judgeReason and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /815/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /combat\/derived-might\.ts/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-054-298 Sunlit Guardian: exactly Shield and Tank keyword declarations, nothing else", () => {
  // Contract 3.1/3.7 + README section 5: the card only declares keywords; any
  // expansion belongs to effects/keywords/<keyword>.ts. The reminder text is
  // the printed explanation of the keyword, not a separate instruction.
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities, [
    { kind: "keyword", keyword: "shield" },
    { kind: "keyword", keyword: "tank" }
  ]);
  assert.equal(program.abilities[0].value, undefined);
  assert.equal(program.abilities[1].value, undefined);
});

test("ogn-054-298 Sunlit Guardian: the program adds no invented static effect for the keywords", () => {
  // Guard against approximating the [Shield] +1 Might with a hand-written
  // static ability (the printed value is 1 per 814.1.b.3, but its gate needs the
  // defender designation of 814.1.d.1, which this keyword condition still
  // cannot read from the canonical derived-might service).
  for (const ability of program.abilities) {
    assert.equal(ability.kind, "keyword");
    assert.equal("effect" in ability, false);
    assert.equal("body" in ability, false);
    assert.equal("trigger" in ability, false);
    assert.equal("condition" in ability, false);
  }
});

test("ogn-054-298 Sunlit Guardian: [Shield] expands to the defender-gated +1 Might static effect (CR 814.1.c)", () => {
  // 814.1.b.3: the omitted Shield Value is 1; 814.1.c makes it "while I am a
  // defender, I have +1 [M]". The merged KeywordDef expands to a static
  // continuous.might gated on the defender designation (814.1.d.1), but the
  // expansion reads designation while ObjectSnapshot exposes combatRole.
  // The program static binder evaluates compare; combat role wiring is pending.
  const shield = keywordDefinitionsById.get("Shield");
  assert.ok(shield, "the merged Shield KeywordDef must be registered");
  assert.equal(shield.valued, true);
  assert.equal(shield.stacking, "sum");
  const [ability] = shield.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  assert.equal(ability.effect.appliesTo, "self");
  // Keep the actual expansion visible: its designation property has not been
  // migrated to the merged combatRole characteristic.
  assert.equal(ability.condition.kind, "compare");
  assert.deepEqual(ability.condition.left, {
    kind: "object-property",
    object: "self",
    property: "designation"
  });
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "defender" });
});

test("ogn-054-298 Sunlit Guardian: [Tank] expands to the continuous.combat damage-assignment declaration (CR 815.1.b)", () => {
  const tank = keywordDefinitionsById.get("Tank");
  assert.ok(tank, "the merged Tank KeywordDef must be registered");
  const [ability] = tank.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.combat");
  assert.equal(ability.effect.mode, "damage-assignment");
  assert.equal(ability.effect.priority, "first");
});

test.todo(
  "ogn-054-298 Sunlit Guardian: [Shield] (814) needs designation -> combatRole alignment " +
    "and an EffectIR role bridge from combat; canonical derived-might already derives defenders, " +
    "and keyword expansion, static registration and compare " +
    "evaluation are merged"
);

test.todo(
  "ogn-054-298 Sunlit Guardian: [Tank] (815) needs the combat damage assignment priority " +
    "(815.1.b/815.1.c.2); the Tank KeywordDef is merged but " +
    "combat/base-combat-allocation.ts binds no assignment-priority requirement — combat allocation workstream"
);

test("Sunlit Guardian: program keyword expansion includes both merged static definitions", () => {
  const kernel = world().unit("guardian", { cardId: CANONICAL }).build();
  const expanded = expandProgram(program, kernel.getObject("guardian"));
  assert.deepEqual(expanded.declared, program.abilities);
  assert.equal(expanded.expanded.length, 2);
  assert.deepEqual(expanded.expanded.map(ability => ability.effect.kind), ["continuous.might", "continuous.combat"]);
  assert.deepEqual(expanded.expanded[0].effect.amount, { kind: "constant", value: 1 });
  assert.equal(expanded.expanded[1].effect.priority, "first");
});
