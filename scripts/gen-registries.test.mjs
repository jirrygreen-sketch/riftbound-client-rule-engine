import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
    cards: path.join(root, "packages", "card-dsl", "src", "cards")
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
        "packages/card-dsl/src/cards/registry.generated.ts",
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
    const cardRegistry = results.find(
      (result) => result.directory === fixture.directories.cards
    );
    assert.ok(instructionRegistry);
    assert.ok(cardRegistry);

    const instructions = await readFile(instructionRegistry.outputPath, "utf8");
    assert.ok(
      instructions.indexOf('"./alpha.js"') < instructions.indexOf('"./zeta.js"')
    );
    assert.doesNotMatch(instructions, /ignored\.js/);
    assert.match(instructions, /instructionDefinitionsById/);

    const cards = await readFile(cardRegistry.outputPath, "utf8");
    assert.ok(
      cards.indexOf('"./set-a/first.js"') < cards.indexOf('"./set-a/second.js"')
    );
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

const supportedSources = [
  ["an object literal", 'export default { op: "actual" };'],
  [
    "an object literal with satisfies",
    'export default { op: "actual" } satisfies Definition;'
  ],
  [
    "a variable with a type annotation",
    'const x: Definition = { op: "actual" }; export default x;'
  ],
  [
    "a typed variable with satisfies",
    'const x: Definition = { op: "actual" } satisfies Definition; export default x;'
  ],
  [
    "a named default export",
    'const x: Definition = { op: "actual" }; export { x as default };'
  ],
  [
    "a named default export before its declaration",
    'export { x as default }; const x: Definition = { op: "actual" };'
  ],
  [
    "parentheses and type assertions",
    'const x = ({ op: "actual" } as const) satisfies Definition; export default (x as Definition)!;'
  ],
  [
    "an angle-bracket type assertion",
    'export default <Definition>{ op: "actual" };'
  ],
  [
    "local aliases",
    'const x = { op: "actual" }; const alias: Definition = x; export default alias;'
  ],
  [
    "backticks and fake exports in JSDoc",
    '/** `unclosed backtick: export default { op: "decoy" }; */\nexport default { op: "actual" };'
  ],
  [
    "backticks in single and double quoted strings",
    'const a = "` export default { op: \\"decoy\\" }"; const b = \'`\';\nexport default { op: "actual" };'
  ],
  [
    "nested template literals and escaped backticks",
    'const text = `\\` ${`export default { op: "decoy" }`} tail`;\nexport default { op: "actual" };'
  ],
  [
    "a non-BMP character before the export",
    '/** 🃏 `definition` */\nexport default { op: "actual" };'
  ],
  [
    "nested and unrelated ids",
    'const other = { op: "decoy" }; export default { nested: { op: "decoy" }, op: "actual" };'
  ],
  [
    "an escaped string id and quoted property name",
    'export default { "op": "act\\u0075al" };'
  ],
  [
    "an escaped single quoted string id",
    "export default { op: 'act\\x75al' };"
  ],
  [
    "a static template string id",
    'export default { op: `actual` };'
  ]
];

for (const [description, source] of supportedSources) {
  test(`recognizes ${description}`, async () => {
    const fixture = await createFixture();
    try {
      await writeDefinition(fixture.directories.instructions, "actual.ts", source);
      // A decoy id in comments, strings, nested objects, or other declarations
      // must not be mistaken for the exported definition's id.
      await writeDefinition(
        fixture.directories.instructions,
        "decoy.ts",
        'export default { op: "decoy" };'
      );
      const results = await generateRegistries({ repoRoot: fixture.root });
      const registry = results.find(
        (result) => result.directory === fixture.directories.instructions
      );
      const generated = await readFile(registry.outputPath, "utf8");
      assert.match(generated, /import entry0 from "\.\/actual\.js"/);
      assert.match(generated, /import entry1 from "\.\/decoy\.js"/);
      assert.ok((await generateRegistries({ repoRoot: fixture.root })).every(
        (result) => !result.changed
      ));
      await writeDefinition(
        fixture.directories.instructions,
        "decoy.ts",
        'export default { op: "actual" };'
      );
      await assert.rejects(generateRegistries({ repoRoot: fixture.root }), (error) => {
        assert.ok(error instanceof RegistryGenerationError);
        assert.match(error.message, /Duplicate registry id "actual"/);
        assert.match(error.message, /actual\.ts/);
        assert.match(error.message, /decoy\.ts/);
        return true;
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

const invalidSources = [
  [
    "fake exports in comments and strings",
    '/** export default { op: "fake" }; */\nconst text = `export default { op: "fake" };`;\nconst value = \'export default { op: "fake" };\';',
    /Missing default export/
  ],
  [
    "an id only inside a nested object",
    'export default { nested: { op: "nested" } };',
    /Missing registry id/
  ],
  [
    "an id only in a later declaration",
    'export default {}; const other = { op: "unrelated" };',
    /Missing registry id/
  ],
  ["an empty id", 'export default { op: "" };', /Empty registry id/],
  [
    "a dynamic id",
    'export default { op: makeId(), id: "fallback" };',
    /static string/
  ],
  [
    "an interpolated template id",
    'export default { op: `effect.${name}` };',
    /static string/
  ],
  [
    "an unresolved identifier",
    'export default missing;',
    /Cannot resolve default export/
  ],
  [
    "a cyclic alias",
    'const a = b; const b = a; export default a;',
    /Cannot resolve default export/
  ],
  [
    "a function call as the default export",
    'export default makeDefinition({ op: "hidden" });',
    /object literal/
  ],
  [
    "a default function declaration",
    'export default function definition() { return { op: "hidden" }; }',
    /Unsupported default export/
  ],
  [
    "an object spread",
    'export default { op: "first", ...other };',
    /spread/
  ],
  [
    "duplicate id properties",
    'export default { op: "first", op: "second" };',
    /Duplicate.*property/
  ],
  [
    "a re-export from another module",
    'export { x as default } from "./other.js";',
    /Unsupported default export/
  ],
  [
    "a type-only default export",
    'type X = { op: "type" }; export type { X as default };',
    /Unsupported default export/
  ],
  [
    "multiple default exports",
    'export default { op: "first" }; export default { op: "second" };',
    /Multiple default exports/
  ],
  [
    "invalid TypeScript syntax",
    'export default { op: "broken";',
    /Invalid TypeScript syntax/
  ]
];

for (const [description, source, message] of invalidSources) {
  test(`rejects ${description} with the source path`, async () => {
    const fixture = await createFixture();
    try {
      await writeDefinition(fixture.directories.instructions, "invalid.ts", source);
      await assert.rejects(generateRegistries({ repoRoot: fixture.root }), (error) => {
        assert.ok(error instanceof RegistryGenerationError);
        assert.match(error.message, message);
        assert.match(error.message, /invalid\.ts/);
        return true;
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

for (const failure of ["missing default export", "duplicate id"]) {
  test(`CLI exits nonzero for ${failure} without rewriting registries`, async () => {
    const fixture = await createFixture();
    try {
      const results = await generateRegistries({ repoRoot: fixture.root });
      const before = await Promise.all(results.map((result) =>
        readFile(result.outputPath, "utf8")
      ));
      await writeDefinition(
        fixture.directories.cards,
        "ignored.ts",
        '// Card definitions are stored in set subdirectories.'
      );
      const cardSet = path.join(fixture.directories.cards, "set-a");
      await mkdir(cardSet);
      await writeDefinition(
        cardSet,
        "first.ts",
        'const x: CardProgram = { canonicalCardId: "duplicate" }; export { x as default };'
      );
      await writeDefinition(
        cardSet,
        "second.ts",
        failure === "duplicate id"
          ? 'export default { canonicalCardId: "dupli\\u0063ate" } satisfies CardProgram;'
          : 'export const x = { canonicalCardId: "missing" };'
      );
      const result = spawnSync(process.execPath, [
        fileURLToPath(new URL("./gen-registries.mjs", import.meta.url)),
        "--root", fixture.root
      ], { encoding: "utf8" });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Registry generation failed:/);
      assert.match(result.stderr, failure === "duplicate id"
        ? /Duplicate registry id "duplicate"/
        : /Missing default export/);
      assert.match(result.stderr, /second\.ts/);
      const after = await Promise.all(results.map((entry) =>
        readFile(entry.outputPath, "utf8")
      ));
      assert.deepEqual(after, before);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}
