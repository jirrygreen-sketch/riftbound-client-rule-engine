import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/shen-kinkou.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden tests load the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordRegistryById } = await import(
  new URL("effects/keywords/registry.generated.js", engineCore)
);

const CANONICAL = "card.hash-02482e5d821a8879fe503e6b27f785f4fc8c8139f58c9bd035f34f92f1b8522a";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n" +
  "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
  "[Tank] (I must be assigned combat damage first.)";

/** The engine registry spells ids in printed case; card programs use the kebab id. */
const keywordDef = (id) => keywordRegistryById.get(id) ?? keywordRegistryById.get(id[0].toUpperCase() + id.slice(1));

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judgeReason must name each missing dependency concretely (README §2).
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /815\.1\.b/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /continuous\.timing/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: three keyword abilities in printed order (Reaction, Shield 2, Tank)", () => {
  assert.equal(program.abilities.length, 3);
  const [reaction, shield, tank] = program.abilities;

  // CR 813.1: [Reaction] is a permissive keyword with no value (813.1.d).
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(reaction.value, undefined);

  // CR 814.1.b.1/.b.2: the printed value 2 is the Shield Value.
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield", value: 2 });

  // CR 815.1: Tank is a passive keyword with no printed value (815.2 redundant).
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  assert.equal(tank.value, undefined);

  // Keyword programs carry no instruction bodies: nothing card-specific runs here.
  for (const ability of program.abilities) assert.equal(ability.body, undefined);
});

test("Reaction/Shield declarations match the merged engine keyword registry (CR 813/814)", () => {
  const reaction = keywordDef("reaction");
  assert.ok(reaction, "effects/keywords/Reaction.ts must be merged for the [Reaction] declaration");
  assert.equal(reaction.keyword, "Reaction");
  assert.equal(reaction.valued, false);
  assert.equal(reaction.stacking, "single");
  // 813.1.c: the expansion is a continuous.timing permission (closed state + showdown).
  assert.deepEqual(reaction.expand({ host: { canonicalCardId: CANONICAL } }), [
    {
      kind: "static",
      effect: {
        kind: "continuous.timing",
        grants: ["showdown", "closed-state"],
        appliesTo: ["card", "activated-ability"]
      }
    }
  ]);

  const shield = keywordDef("shield");
  assert.ok(shield, "effects/keywords/Shield.ts must be merged for the [Shield 2] declaration");
  assert.equal(shield.keyword, "Shield");
  assert.equal(shield.valued, true);
  // 814.2: several Shield grants sum into one value, so the registry merges them.
  assert.equal(shield.stacking, "sum");

  const expansion = shield.expand({ value: 2, host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].kind, "static");
  // 814.1.c: "While I am a defender, I have +2 [M]".
  assert.equal(expansion[0].effect.kind, "continuous.might");
  assert.equal(expansion[0].effect.layer, "arithmetic");
  assert.deepEqual(expansion[0].effect.amount, { kind: "constant", value: 2 });
  // 814.1.d.1: the grant is live only while the host holds the Defender designation.
  assert.equal(expansion[0].condition.kind, "compare");
  assert.equal(expansion[0].condition.left.property, "designation");
  assert.deepEqual(expansion[0].condition.right, { kind: "constant", value: "defender" });
  const wrapped = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: "core-1.5",
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.equal(wrapped.ok, true, JSON.stringify(wrapped.issues, null, 2));
});

test("Tank expands to a continuous.combat requirement with no combat consumer", () => {
  // 815.1.b ("I must be assigned lethal damage before any other unit with the
  // same controller as me that does not have [Tank] during the Combat Damage
  // step") now has the merged Tank KeywordDef (RIFT-264), but its expansion is
  // a continuous.combat declaration the combat kernels never read (see
  // combat/base-combat-allocation.ts). This assertion documents the exact gap
  // named by judgeReason.
  const tank = keywordDef("tank");
  assert.ok(tank, "effects/keywords/Tank.ts must be merged for the [Tank] declaration");
  assert.equal(tank.valued, false);
  assert.equal(tank.stacking, "single");
  const expansion = tank.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].kind, "static");
  assert.equal(expansion[0].effect.kind, "continuous.combat");
  assert.equal(expansion[0].effect.mode, "damage-assignment");
  assert.equal(expansion[0].effect.priority, "first");
});

test.todo(
  "[Tank] expansion and combat-damage assignment priority (CR 815.1.b, 815.1.c.1, 815.1.c.2): " +
    "the Tank KeywordDef is merged (RIFT-264), but combat/ still needs the assignment-priority " +
    "binding (base-combat-allocation.ts currently binds none) and the continuous.combat consumer"
);

test.todo(
  "[Shield 2] arithmetic Might in the layers pipeline (CR 814.1.c/814.1.d): the keyword expansion is " +
    "merged (with the compare(designation == defender) condition), but ObjectSnapshot has no " +
    "'designation' characteristic and layers conditionMatches does not evaluate compare conditions, " +
    "so the +2 [M] cannot be applied only while defending (RIFT-91)"
);

test.todo(
  "[Reaction] closed-state play permission (CR 813.1.c): the layers/rules canAct query consumes " +
    "continuous.timing (RIFT-259), but nothing registers a card/keyword expansion into the layers " +
    "registry and chain.canAct() reads only its own state"
);
