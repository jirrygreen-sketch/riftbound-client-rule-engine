import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  generateRegistries,
  RegistryGenerationError
} from "./gen-registries.mjs";

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rift-registry-"));
  const directories = {
    instructions: path.join(
      root,
      "packages",
      "engine-core",
      "src",
      "effects",
      "instructions"
    ),
    keywords: path.join(
      root,
      "packages",
      "engine-core",
      "src",
      "effects",
      "keywords"
    ),
    cards: path.join(root, "packages", "card-dsl", "cards")
  };
  await Promise.all(
    Object.values(directories).map((directory) =>
      mkdir(directory, { recursive: true })
    )
  );
  return { root, directories };
}

async function writeDefinition(directory, fileName, definition) {
  await writeFile(path.join(directory, fileName), definition, "utf8");
}

test("generates valid empty registries for empty source directories", async () => {
  const fixture = await createFixture();
  try {
    const results = await generateRegistries({ repoRoot: fixture.root });

    assert.deepEqual(
      results
        .map((result) => path.relative(fixture.root, result.outputPath))
        .sort(),
      [
        "packages/engine-core/src/effects/instructions/registry.generated.ts",
        "packages/engine-core/src/effects/keywords/registry.generated.ts"
      ]
    );
    for (const result of results) {
      const generated = await readFile(result.outputPath, "utf8");
      assert.match(generated, /Object\.freeze\(\[\] as const\)/);
      assert.match(generated, /ReadonlyMap<string/);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("sorts imports, ignores tests, and generates card-set registries", async () => {
  const fixture = await createFixture();
  try {
    await writeDefinition(
      fixture.directories.instructions,
      "zeta.ts",
      'export default { op: "zeta" };\n'
    );
    await writeDefinition(
      fixture.directories.instructions,
      "alpha.ts",
      'export default { op: "alpha" };\n'
    );
    await writeDefinition(
      fixture.directories.instructions,
      "ignored.test.ts",
      'export default { op: "ignored" };\n'
    );

    const cardSet = path.join(fixture.directories.cards, "set-a");
    await mkdir(cardSet, { recursive: true });
    await writeDefinition(
      cardSet,
      "second.ts",
      'export default { canonicalCardId: "card.second" };\n'
    );
    await writeDefinition(
      cardSet,
      "first.ts",
      'const card = { canonicalCardId: "card.first" };\nexport default card;\n'
    );

    const results = await generateRegistries({ repoRoot: fixture.root });
    const instructionRegistry = results.find(
      (result) => result.directory === fixture.directories.instructions
    );
    const cardRegistry = results.find((result) => result.directory === cardSet);
    assert.ok(instructionRegistry);
    assert.ok(cardRegistry);

    const instructions = await readFile(instructionRegistry.outputPath, "utf8");
    assert.ok(
      instructions.indexOf('"./alpha.js"') < instructions.indexOf('"./zeta.js"')
    );
    assert.doesNotMatch(instructions, /ignored\.js/);
    assert.match(instructions, /instructionDefinitionsById/);

    const cards = await readFile(cardRegistry.outputPath, "utf8");
    assert.ok(cards.indexOf('"./first.js"') < cards.indexOf('"./second.js"'));
    assert.match(cards, /cardProgramsById/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects duplicate registry ids with both source paths", async () => {
  const fixture = await createFixture();
  try {
    await writeDefinition(
      fixture.directories.keywords,
      "first.ts",
      'export default { id: "duplicate" };\n'
    );
    await writeDefinition(
      fixture.directories.keywords,
      "second.ts",
      'export default { id: "duplicate" };\n'
    );

    await assert.rejects(
      generateRegistries({ repoRoot: fixture.root }),
      (error) => {
        assert.ok(error instanceof RegistryGenerationError);
        assert.match(error.message, /Duplicate registry id "duplicate"/);
        assert.match(error.message, /first\.ts/);
        assert.match(error.message, /second\.ts/);
        return true;
      }
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a source file without a default export", async () => {
  const fixture = await createFixture();
  try {
    await writeDefinition(
      fixture.directories.instructions,
      "missing-default.ts",
      'export const definition = { op: "missing-default" };\n'
    );

    await assert.rejects(
      generateRegistries({ repoRoot: fixture.root }),
      (error) => {
        assert.ok(error instanceof RegistryGenerationError);
        assert.match(error.message, /Missing default export/);
        assert.match(error.message, /missing-default\.ts/);
        return true;
      }
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
