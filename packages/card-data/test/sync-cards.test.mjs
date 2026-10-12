import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.dirname(testDirectory);
const repositoryRoot = path.dirname(path.dirname(packageDirectory));
const scriptPath = path.join(packageDirectory, "scripts", "sync-cards.mjs");
const defaultOutputPath = path.join(packageDirectory, "dist", "cards.json");
const syncCards = import(new URL("../scripts/sync-cards.mjs", import.meta.url));
const cardData = import(new URL("../dist/index.js", import.meta.url));
const syntheticCards = [
  {
    cardCode: "syn-001",
    name: "Synthetic Scout",
    subtitle: "Unseen",
    fullName: "Synthetic Scout, Unseen",
    setCode: "syn",
    cardSet: "Synthetic Set",
    cardNumber: "001-008",
    rarity: "Common",
    domain: "Calm",
    domains: ["Calm"],
    cardType: "Unit",
    cardTypeLabels: ["Unit"],
    tags: ["Originated Here"],
    energy: 2,
    power: 1,
    might: 3,
    abilityOriginal: "When I arrive, draw a card.",
    abilityCorrected: "When I arrive, draw a card.",
    abilityEffective: "When I arrive, draw a card.",
    hasErrata: true,
    matchedErrataCode: "syn-errata-1",
    artist: "Synthetic Artist",
    imageUrl: "https://cdn.example.test/syn-001.png",
    sourceUrl: "https://example.test/cards/syn-001",
    scrapedAt: "2026-10-11T00:00:00.000Z",
    extension: {
      rulesText: ["Original wording", "Corrected wording"],
      nested: { origin: "synthetic-fixture", revision: 1 }
    }
  },
  {
    cardCode: "syn-002",
    name: "Synthetic Rune",
    fullName: "Synthetic Rune",
    setCode: "syn",
    cardSet: "Synthetic Set",
    cardNumber: "r01",
    rarity: "Showcase",
    domain: "Fury",
    domains: ["Fury"],
    cardType: "Rune",
    cardTypeLabels: ["Rune", "Basic"],
    tags: [],
    energy: null,
    power: null,
    might: null,
    abilityOriginal: null,
    abilityCorrected: null,
    abilityEffective: null,
    hasErrata: false,
    matchedErrataCode: null,
    artist: null,
    imageUrl: "https://cdn.example.test/syn-002.png",
    sourceUrl: "https://example.test/cards/syn-002",
    scrapedAt: "2026-10-11T00:00:01.000Z",
    extension: {
      rulesText: [],
      nested: { origin: "synthetic-fixture", revision: 2 }
    }
  },
  {
    cardCode: "syn-003",
    name: "Synthetic Gear",
    fullName: "Synthetic Gear",
    setCode: "syn",
    cardSet: "Synthetic Set",
    cardNumber: "003-008",
    rarity: "Rare",
    domain: "Mind",
    domains: ["Mind", "Order"],
    cardType: "Gear",
    cardTypeLabels: ["Gear", "Token"],
    tags: ["Device"],
    energy: 0,
    power: null,
    might: null,
    abilityOriginal: "Original synthetic ability.",
    abilityCorrected: "Corrected synthetic ability.",
    abilityEffective: "Corrected synthetic ability.",
    hasErrata: true,
    matchedErrataCode: "syn-errata-3",
    artist: "Another Synthetic Artist",
    imageUrl: "https://cdn.example.test/syn-003.png",
    sourceUrl: "https://example.test/cards/syn-003",
    scrapedAt: "2026-10-11T00:00:02.000Z",
    extension: {
      rulesText: ["Original synthetic ability.", "Corrected synthetic ability."],
      nested: { origin: "synthetic-fixture", revision: 3 }
    }
  }
];

function runMain(script, argv) {
  const logs = [];
  const errors = [];
  return script.main(argv, {
    log: (message) => logs.push(String(message)),
    error: (message) => errors.push(String(message))
  }).then((exitCode) => ({ exitCode, logs, errors }));
}

async function withFixedDownloadDate(isoDate, callback) {
  const originalDate = Date;
  globalThis.Date = class extends originalDate {
    constructor(...args) {
      super(...(args.length === 0 ? [originalDate.parse(isoDate)] : args));
    }

    static now() {
      return originalDate.parse(isoDate);
    }
  };

  try {
    return await callback();
  } finally {
    globalThis.Date = originalDate;
  }
}

function runCli(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [scriptPath, ...args],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 5_000
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error?.code ?? 0,
          stdout,
          stderr,
          executionError: error
        });
      }
    );
  });
}

async function withMockFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    return handler(url, init, calls.length - 1);
  };

  try {
    return await callback(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeRawCard(cardCode) {
  return {
    cardCode,
    fullName: "Test Card",
    setCode: "tst",
    rarity: "Common",
    domains: ["Calm"],
    cardType: "Unit",
    energy: 1,
    power: null
  };
}

test("can be imported without running main and keeps its public test surface", async () => {
  const script = await syncCards;

  assert.equal(typeof script.parseArguments, "function");
  assert.equal(typeof script.transformCards, "function");
  assert.equal(typeof script.main, "function");
  assert.equal(script.DEFAULT_TIMEOUT_MS, 30_000);
});

test("round-trips a synthetic full-field fixture without losing source records", async () => {
  const [script, api] = await Promise.all([syncCards, cardData]);

  assert.equal(
    script.resolveOutputPath(undefined),
    defaultOutputPath
  );

  const rebuilt = script.transformCards(
    syntheticCards,
    "2026-10-11",
    api.createCardDataBundle
  );
  assert.equal(rebuilt.manifest.cardCount, syntheticCards.length);

  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "sync-cards-roundtrip-")
  );
  const outputPath = path.join(temporaryDirectory, "cards.json");
  try {
    await withMockFetch(
      async () => new Response(JSON.stringify(syntheticCards), { status: 200 }),
      async () => {
        const result = await withFixedDownloadDate(
          "2026-10-11T00:00:00.000Z",
          () => runMain(script, [
            "--source",
            "https://example.com/cards.json",
            "--output",
            outputPath,
            "--timeout-ms",
            "1000"
          ])
        );

        assert.equal(result.exitCode, 0);
        const written = JSON.parse(await readFile(outputPath, "utf8"));
        assert.deepEqual(written.cards, syntheticCards);
        assert.deepEqual(written.bundle, rebuilt);
        assert.equal(written.bundle.manifest.cardCount, syntheticCards.length);
      }
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("rejects invalid input and duplicate normalized card ids", async () => {
  const script = await syncCards;
  const passthroughBundle = (content) => content;

  assert.throws(
    () => script.transformCards(
      [makeRawCard("DUP-1"), makeRawCard("dup 1")],
      "2026-10-11",
      passthroughBundle
    ),
    /duplicate card id card\.dup-1/
  );
  assert.throws(
    () => script.transformCards([], "2026-10-11", passthroughBundle),
    /non-empty JSON array/
  );
  assert.throws(
    () => script.transformCards(
      [{ ...makeRawCard("bad-cost"), energy: -1 }],
      "2026-10-11",
      passthroughBundle
    ),
    /energy must be an integer/
  );
  assert.throws(
    () => script.transformCards(
      [{ ...makeRawCard("bad-domains"), domains: [1] }],
      "2026-10-11",
      passthroughBundle
    ),
    /domains must be an array of strings/
  );
  assert.throws(
    () => script.parseRawCards(Buffer.from("{}"), "https://example.com/cards.json"),
    /non-empty JSON array/
  );
});

test("only github.com download URLs contribute repository metadata", async () => {
  const script = await syncCards;
  const github = await script.resolveSource(
    "https://github.com/example/cards/releases/download/v1/cards.json",
    1_000
  );
  assert.deepEqual(github.metadata, {
    sourceType: "direct-url",
    repository: "example/cards",
    releaseTag: "v1"
  });

  const lookalike = await script.resolveSource(
    "https://github.com.evil.example/example/cards/releases/download/v1/cards.json",
    1_000
  );
  assert.deepEqual(lookalike.metadata, { sourceType: "direct-url" });

  await assert.rejects(
    script.resolveSource("http://github.com/example/cards/cards.json", 1_000),
    /GitHub owner\/repository slug or an HTTPS URL/
  );
});

test("a digest mismatch fails without replacing an existing output file", async () => {
  const script = await syncCards;
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "sync-cards-digest-")
  );
  const outputPath = path.join(temporaryDirectory, "cards.json");
  const existingOutput = "{\"preserve\":true}\n";
  await writeFile(outputPath, existingOutput, "utf8");

  try {
    await withMockFetch(async (url, _init, callIndex) => {
      if (callIndex === 0) {
        assert.equal(
          url,
          "https://api.github.com/repos/example/cards/releases/latest"
        );
        return jsonResponse({
          tag_name: "v1",
          html_url: "https://github.com/example/cards/releases/tag/v1",
          assets: [{
            name: "cards.json",
            browser_download_url:
              "https://github.com/example/cards/releases/download/v1/cards.json",
            digest: `sha256:${"0".repeat(64)}`
          }]
        });
      }

      return new Response(JSON.stringify([makeRawCard("test-001")]), {
        status: 200
      });
    }, async () => {
      const result = await runMain(script, [
        "--source",
        "example/cards",
        "--output",
        outputPath,
        "--timeout-ms",
        "1000"
      ]);

      assert.equal(result.exitCode, 1);
      assert.match(result.errors[0], /SHA-256 mismatch/);
      assert.equal(await readFile(outputPath, "utf8"), existingOutput);
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("timeouts and parameter errors return readable failures", async () => {
  const script = await syncCards;

  await withMockFetch(async () => {
    const error = new Error("request aborted");
    error.name = "TimeoutError";
    error.code = "ABORT_ERR";
    throw error;
  }, async () => {
    const timeout = await runMain(script, [
      "--source",
      "https://example.com/cards.json",
      "--timeout-ms",
      "1"
    ]);

    assert.equal(timeout.exitCode, 1);
    assert.deepEqual(timeout.errors, [
      "sync-cards failed: request timed out after 1ms"
    ]);
  });

  assert.throws(
    () => script.parseArguments(["--source-malformed"]),
    /Unknown option/
  );
  assert.throws(
    () => script.parseArguments(["--outputjunk"]),
    /Unknown option/
  );
  assert.throws(
    () => script.parseArguments(["--source"]),
    /--source requires a value/
  );
  assert.throws(
    () => script.parseArguments(["--source", "--dry-run"]),
    /--source requires a value/
  );
  assert.throws(
    () => script.parseArguments(["--output", "--dry-run"]),
    /--output requires a value/
  );
  assert.throws(
    () => script.parseArguments(["--timeout-ms", "--dry-run"]),
    /--timeout-ms requires a value/
  );

  const unknown = await runCli(["--source-malformed"]);
  assert.equal(unknown.exitCode, 1);
  assert.match(unknown.stderr, /Unknown option: --source-malformed/);

  const missing = await runCli(["--timeout-ms"]);
  assert.equal(missing.exitCode, 1);
  assert.match(missing.stderr, /--timeout-ms requires a value/);
});

test("fetchJson propagates timeout errors raised while reading response bodies", async () => {
  const script = await syncCards;
  const timeoutError = () => {
    const error = new Error("response body timed out");
    error.name = "TimeoutError";
    error.code = "ABORT_ERR";
    return error;
  };

  await withMockFetch(
    async () => new Response("not json", { status: 500 }),
    async () => {
      const response = new Response(null, { status: 500 });
      Object.defineProperty(response, "text", {
        value: async () => {
          throw timeoutError();
        }
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => response;
      try {
        await assert.rejects(
          script.fetchJson("https://example.com/failed", 1),
          (error) => error.name === "TimeoutError"
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );

  const response = new Response("{}", { status: 200 });
  Object.defineProperty(response, "json", {
    value: async () => {
      throw timeoutError();
    }
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response;
  try {
    await assert.rejects(
      script.fetchJson("https://example.com/ok", 1),
      (error) => error.name === "TimeoutError"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
