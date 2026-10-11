import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.dirname(testDirectory);
const scriptPath = path.join(packageDirectory, "scripts", "sync-images.mjs");
const syncImages = import(new URL("../scripts/sync-images.mjs", import.meta.url));

const OFFICIAL_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/card.png?v=42";

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function pngBytes(marker = 1) {
  const header = Buffer.alloc(25);
  header.writeUInt32BE(13, 0);
  header.write("IHDR", 4, "ascii");
  header.writeUInt32BE(1, 8);
  header.writeUInt32BE(1, 12);
  header[16] = 8;
  header[17] = 6;
  const text = Buffer.from(`synthetic-png-${marker}`, "utf8");
  const textChunk = Buffer.alloc(12 + text.length);
  textChunk.writeUInt32BE(text.length, 0);
  textChunk.write("tEXt", 4, "ascii");
  text.copy(textChunk, 8);
  const end = Buffer.alloc(12);
  end.writeUInt32BE(0, 0);
  end.write("IEND", 4, "ascii");
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    header,
    textChunk,
    end
  ]);
}

function jpegBytes(marker = 1) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from(`synthetic-jpeg-${marker}`, "utf8"),
    Buffer.from([0xff, 0xd9])
  ]);
}

function webpBytes(marker = 1) {
  const payload = Buffer.from(`synthetic-webp-${marker}`, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(4 + payload.length, 0);
  return Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    length,
    Buffer.from("WEBP", "ascii"),
    payload
  ]);
}

function avifBytes() {
  function box(type, payload) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + payload.length);
    header.write(type, 4, "ascii");
    return Buffer.concat([header, payload]);
  }
  return Buffer.concat([
    box("ftyp", Buffer.from("avif\0\0\0\0mif1avif", "ascii")),
    box("meta", Buffer.from("\0\0\0\0synthetic-metadata", "ascii")),
    box("mdat", Buffer.from("synthetic-av1-payload", "ascii"))
  ]);
}

test("accepts CDN AVIF regardless of URL suffix and rejects truncated boxes", async () => {
  const script = await syncImages;
  const bytes = avifBytes();
  assert.equal(script.detectImageType(bytes), "avif");
  await withMockFetch(
    async () => imageResponse(bytes, "image/avif"),
    async () => {
      const image = await script.downloadImage(OFFICIAL_URL, {
        timeoutMs: 1000,
        retries: 0
      });
      assert.equal(image.extension, "avif");
      assert.equal(image.contentType, "image/avif");
      assert.equal(image.sha256, sha256(bytes));
    }
  );
  await withMockFetch(
    async () => imageResponse(bytes.subarray(0, bytes.length - 1), "image/avif"),
    async () => assert.rejects(
      script.downloadImage(OFFICIAL_URL, { timeoutMs: 1000, retries: 0 }),
      /incomplete AVIF/
    )
  );
  await withTempDirectory("sync-images-avif-", async directory => {
    const catalogPath = await writeCatalog(directory, catalog([
      { id: "card-avif", imageUrl: OFFICIAL_URL }
    ]));
    const output = path.join(directory, "images");
    const manifestPath = path.join(directory, "manifest.json");
    const args = ["--catalog", catalogPath, "--output", output, "--manifest", manifestPath];
    await withMockFetch(
      async () => imageResponse(bytes, "image/avif"),
      async calls => {
        assert.equal((await runMain(script, args)).exitCode, 0);
        assert.equal((await runMain(script, args)).exitCode, 0);
        assert.equal(calls.length, 1);
      }
    );
    assert.deepEqual(await readFile(path.join(output, "card-avif.avif")), bytes);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.counts.resumed, 1);
    assert.equal(manifest.images[0].contentType, "image/avif");
  });
});

function catalog(cards, overrides = {}) {
  return {
    dataVersion: "catalog-2026-10-11",
    digest: `sha256:${"1".repeat(64)}`,
    cards,
    ...overrides
  };
}

function imageResponse(bytes, contentType, options = {}) {
  const response = new Response(bytes, {
    status: options.status ?? 200,
    headers: options.headers ?? { "content-type": contentType }
  });
  if (options.url !== undefined) {
    Object.defineProperty(response, "url", {
      value: options.url
    });
  }
  return response;
}

function pngResponse(bytes, options) {
  return imageResponse(bytes, "image/png", options);
}

function runMain(script, argv) {
  const logs = [];
  const errors = [];
  return script.main(argv, {
    log: (message) => logs.push(String(message)),
    error: (message) => errors.push(String(message))
  }).then((exitCode) => ({ exitCode, logs, errors }));
}

function runCli(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [scriptPath, ...args],
      {
        cwd: packageDirectory,
        encoding: "utf8",
        timeout: 10_000
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

async function withTempDirectory(prefix, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeCatalog(directory, value) {
  const catalogPath = path.join(directory, "catalog.json");
  await writeFile(catalogPath, `${JSON.stringify(value)}\n`, "utf8");
  return catalogPath;
}

function timeoutError() {
  const error = new Error("synthetic timeout");
  error.name = "TimeoutError";
  error.code = "ABORT_ERR";
  return error;
}

test("can be imported without running main and exposes its CLI surface", async () => {
  const script = await syncImages;

  assert.equal(typeof script.parseArguments, "function");
  assert.equal(typeof script.normalizeCatalog, "function");
  assert.equal(typeof script.downloadImage, "function");
  assert.equal(typeof script.runSync, "function");
  assert.equal(typeof script.main, "function");
  assert.equal(script.DEFAULT_CONCURRENCY, 4);
  assert.equal(script.MAX_CONCURRENCY, 8);
  assert.equal(script.DEFAULT_TIMEOUT_MS, 30_000);
  assert.equal(script.OFFICIAL_IMAGE_HOST, "cmsassets.rgpub.io");
});

test("default paths are relative to the script and query parameters survive", async () => {
  const script = await syncImages;
  const defaults = script.resolveDefaultPaths();

  assert.equal(
    defaults.catalog,
    path.join(packageDirectory, "data", "catalog.json")
  );
  assert.equal(
    defaults.output,
    path.join(packageDirectory, "data", "images")
  );
  assert.equal(
    defaults.manifest,
    path.join(packageDirectory, "data", "images-manifest.json")
  );
  assert.equal(script.detectImageType(pngBytes()), "png");
  assert.equal(script.detectImageType(jpegBytes()), "jpeg");
  assert.equal(script.detectImageType(webpBytes()), "webp");
  assert.equal(script.detectImageType(Buffer.from("not an image")), null);

  const normalized = script.normalizeCatalog(catalog([{
    id: "card-001",
    imageUrl: OFFICIAL_URL
  }]));
  assert.equal(normalized.sourceCatalog.dataVersion, "catalog-2026-10-11");
  assert.equal(normalized.sourceCatalog.digest, `sha256:${"1".repeat(64)}`);
  assert.equal(normalized.cards[0].imageUrl, OFFICIAL_URL);
  assert.equal(normalized.cards[0].urlError, null);
});

test("normalizes null images and rejects unsafe ids, hosts, and digests", async () => {
  const script = await syncImages;
  const normalized = script.normalizeCatalog(catalog([
    { id: "card-null", imageUrl: null }
  ]));
  assert.equal(normalized.cards[0].missing, true);

  assert.throws(
    () => script.normalizeCatalog(catalog([
      { id: "../escape", imageUrl: OFFICIAL_URL }
    ])),
    /safe image id whitelist/
  );
  const invalidHost = script.normalizeCatalog(catalog([
    { id: "card-1", imageUrl: "https://cmsassets.rgpub.io.evil.test/a.png" }
  ], { dataVersion: "v1" }));
  assert.match(invalidHost.cards[0].urlError, /host must be cmsassets\.rgpub\.io/);
  assert.throws(
    () => script.normalizeCatalog(catalog([], {
      dataVersion: "v1",
      digest: "not-a-digest"
    })),
    /non-empty array/
  );
  assert.throws(
    () => script.normalizeCatalog({
      dataVersion: "v1",
      digest: "sha256:bad",
      cards: [{ id: "card-1", imageUrl: OFFICIAL_URL }]
    }),
    /SHA-256 digest/
  );
  assert.throws(
    () => script.normalizeCatalog(catalog([
      { id: "card-1", imageUrl: OFFICIAL_URL },
      { id: "card-1", imageUrl: OFFICIAL_URL }
    ])),
    /duplicate id/
  );
});

test("downloads valid PNG, JPEG, and WebP with bounded concurrency", async () => {
  const script = await syncImages;
  await withTempDirectory("sync-images-formats-", async (directory) => {
    const catalogPath = await writeCatalog(directory, catalog([
      {
        id: "card-png",
        imageUrl:
          "https://cmsassets.rgpub.io/sanity/files/dsfx7636/png.png?v=1"
      },
      {
        id: "card-jpeg",
        imageUrl:
          "https://cmsassets.rgpub.io/sanity/files/dsfx7636/jpeg.jpg?version=2"
      },
      {
        id: "card-webp",
        imageUrl:
          "https://cmsassets.rgpub.io/sanity/files/dsfx7636/webp.webp"
      }
    ]));
    const output = path.join(directory, "images");
    const manifestPath = path.join(directory, "images-manifest.json");
    const bodies = {
      png: pngBytes(1),
      jpeg: jpegBytes(2),
      webp: webpBytes(3)
    };
    const contentTypes = {
      png: "image/png",
      jpeg: "image/jpeg; charset=binary",
      webp: "image/webp"
    };
    let active = 0;
    let maximumActive = 0;

    const result = await withMockFetch(async (url) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      const format = url.includes("jpeg")
        ? "jpeg"
        : url.includes("webp")
          ? "webp"
          : "png";
      return imageResponse(bodies[format], contentTypes[format]);
    }, async () => runMain(script, [
      "--catalog",
      catalogPath,
      "--output",
      output,
      "--manifest",
      manifestPath,
      "--concurrency",
      "2",
      "--timeout-ms",
      "1000"
    ]));

    assert.equal(result.exitCode, 0);
    assert.equal(maximumActive <= 2, true);
    assert.deepEqual(
      (await readdir(output)).sort(),
      ["card-jpeg.jpg", "card-png.png", "card-webp.webp"]
    );
    assert.deepEqual(await readFile(path.join(output, "card-png.png")), bodies.png);
    assert.deepEqual(await readFile(path.join(output, "card-jpeg.jpg")), bodies.jpeg);
    assert.deepEqual(await readFile(path.join(output, "card-webp.webp")), bodies.webp);

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.ok, true);
    assert.equal(manifest.partial, false);
    assert.equal(manifest.counts.downloaded, 3);
    assert.equal(manifest.images.length, 3);
    assert.equal(
      manifest.images.find((entry) => entry.id === "card-jpeg").url,
      "https://cmsassets.rgpub.io/sanity/files/dsfx7636/jpeg.jpg?version=2"
    );
    for (const entry of manifest.images) {
      const bytes = await readFile(path.join(output, entry.file));
      assert.equal(entry.bytes, bytes.byteLength);
      assert.equal(entry.sha256, await sha256(bytes));
    }
  });
});

test("resume verifies hash and bytes and re-downloads a corrupted file", async () => {
  const script = await syncImages;
  await withTempDirectory("sync-images-resume-", async (directory) => {
    const imageUrl =
      "https://cmsassets.rgpub.io/sanity/files/dsfx7636/card.png?rev=9";
    const catalogPath = await writeCatalog(directory, catalog([
      { id: "card-resume", imageUrl }
    ]));
    const output = path.join(directory, "images");
    const manifestPath = path.join(directory, "images-manifest.json");
    const original = pngBytes(9);
    let calls = 0;

    const first = await withMockFetch(
      async () => {
        calls += 1;
        return pngResponse(original);
      },
      async () => runMain(script, [
        "--catalog", catalogPath,
        "--output", output,
        "--manifest", manifestPath,
        "--timeout-ms", "1000"
      ])
    );
    assert.equal(first.exitCode, 0);
    assert.equal(calls, 1);

    const second = await withMockFetch(
      async () => {
        calls += 1;
        return pngResponse(pngBytes(10));
      },
      async () => runMain(script, [
        "--catalog", catalogPath,
        "--output", output,
        "--manifest", manifestPath,
        "--timeout-ms", "1000"
      ])
    );
    assert.equal(second.exitCode, 0);
    assert.equal(calls, 1);
    const secondManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(secondManifest.counts.resumed, 1);
    assert.equal(secondManifest.counts.downloaded, 0);

    await writeFile(path.join(output, "card-resume.png"), Buffer.from("corrupt"), "utf8");
    const replacement = pngBytes(11);
    const third = await withMockFetch(
      async () => {
        calls += 1;
        return pngResponse(replacement);
      },
      async () => runMain(script, [
        "--catalog", catalogPath,
        "--output", output,
        "--manifest", manifestPath,
        "--timeout-ms", "1000"
      ])
    );
    assert.equal(third.exitCode, 0);
    assert.equal(calls, 2);
    const thirdManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(thirdManifest.counts.downloaded, 1);
    assert.equal(
      thirdManifest.images[0].sha256,
      await sha256(replacement)
    );
  });
});

test("partial limits are marked and dry-run does not create files", async () => {
  const script = await syncImages;
  await withTempDirectory("sync-images-dry-run-", async (directory) => {
    const catalogPath = await writeCatalog(directory, catalog([
      {
        id: "card-1",
        imageUrl:
          "https://cmsassets.rgpub.io/sanity/files/one.png?a=1"
      },
      {
        id: "card-2",
        imageUrl:
          "https://cmsassets.rgpub.io/sanity/files/two.jpg?b=2"
      }
    ]));
    const output = path.join(directory, "images");
    const manifestPath = path.join(directory, "images-manifest.json");
    let requests = 0;

    const dryRun = await withMockFetch(
      async () => {
        requests += 1;
        return pngResponse(pngBytes(1));
      },
      async () => runMain(script, [
        "--catalog", catalogPath,
        "--output", output,
        "--manifest", manifestPath,
        "--dry-run",
        "--limit", "1",
        "--timeout-ms", "1000"
      ])
    );
    assert.equal(dryRun.exitCode, 0);
    assert.match(dryRun.logs[0], /downloaded=0.*pending=1.*partial=true/);
    assert.equal(requests, 0);
    await assert.rejects(readFile(manifestPath, "utf8"), { code: "ENOENT" });
    await assert.rejects(readdir(output), { code: "ENOENT" });

    const partial = await withMockFetch(
      async () => pngResponse(pngBytes(2)),
      async () => runMain(script, [
        "--catalog", catalogPath,
        "--output", output,
        "--manifest", manifestPath,
        "--limit", "1",
        "--timeout-ms", "1000"
      ])
    );
    assert.equal(partial.exitCode, 0);
    const partialManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(partialManifest.partial, true);
    assert.equal(partialManifest.counts.catalogCards, 2);
    assert.equal(partialManifest.counts.selectedCards, 1);
    assert.equal(partialManifest.images.length, 1);
  });
});

test("a timeout is retried and succeeds on the next attempt", async () => {
  const script = await syncImages;
  await withTempDirectory("sync-images-timeout-", async (directory) => {
    const catalogPath = await writeCatalog(directory, catalog([
      {
        id: "card-timeout",
        imageUrl:
          "https://cmsassets.rgpub.io/sanity/files/timeout.png"
      }
    ]));
    const output = path.join(directory, "images");
    const manifestPath = path.join(directory, "images-manifest.json");
    let attempts = 0;

    const result = await withMockFetch(
      async () => {
        attempts += 1;
        if (attempts === 1) throw timeoutError();
        return pngResponse(pngBytes("after-timeout"));
      },
      async () => runMain(script, [
        "--catalog", catalogPath,
        "--output", output,
        "--manifest", manifestPath,
        "--retries", "1",
        "--timeout-ms", "1000"
      ])
    );

    assert.equal(result.exitCode, 0);
    assert.equal(attempts, 2);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.counts.downloaded, 1);
    assert.equal(manifest.counts.failed, 0);
  });
});

test("non-image responses fail and missing images are reported", async () => {
  const script = await syncImages;
  await withTempDirectory("sync-images-errors-", async (directory) => {
    const catalogPath = await writeCatalog(directory, catalog([
      {
        id: "card-not-image",
        imageUrl:
          "https://cmsassets.rgpub.io/sanity/files/text.png"
      },
      {
        id: "card-missing",
        imageUrl: null
      }
    ]));
    const output = path.join(directory, "images");
    const manifestPath = path.join(directory, "images-manifest.json");
    const calls = [];

    const result = await withMockFetch(async (url) => {
      calls.push(url);
      return imageResponse(Buffer.from("plain text"), "text/plain");
    }, async () => runMain(script, [
      "--catalog", catalogPath,
      "--output", output,
      "--manifest", manifestPath,
      "--concurrency", "4",
      "--retries", "1",
      "--timeout-ms", "1000"
    ]));

    assert.equal(result.exitCode, 1);
    assert.equal(calls.filter((url) => url.includes("text.png")).length, 1);
    assert.match(result.errors.join("\n"), /card-missing/);
    assert.match(result.errors.join("\n"), /card-not-image/);

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.ok, false);
    assert.deepEqual(manifest.missing, ["card-missing"]);
    assert.deepEqual(
      manifest.failures.map((failure) => failure.id),
      ["card-not-image"]
    );
    assert.match(manifest.failures[0].error, /content-type|magic/);
    await assert.rejects(readdir(output), { code: "ENOENT" });
  });
});

test("failures do not replace a valid old image and recover on the next run", async () => {
  const script = await syncImages;
  await withTempDirectory("sync-images-recovery-", async (directory) => {
    const catalogPath = await writeCatalog(directory, catalog([
      {
        id: "card-recover",
        imageUrl:
          "https://cmsassets.rgpub.io/sanity/files/recover.png?v=1"
      }
    ]));
    const output = path.join(directory, "images");
    const manifestPath = path.join(directory, "images-manifest.json");
    const valid = pngBytes("valid");

    const first = await withMockFetch(
      async () => pngResponse(valid),
      async () => runMain(script, [
        "--catalog", catalogPath,
        "--output", output,
        "--manifest", manifestPath,
        "--timeout-ms", "1000"
      ])
    );
    assert.equal(first.exitCode, 0);

    const changedCatalogPath = await writeCatalog(directory, catalog([
      {
        id: "card-recover",
        imageUrl:
          "https://cmsassets.rgpub.io/sanity/files/recover.png?v=2"
      }
    ]));
    const oldManifest = await readFile(manifestPath, "utf8");
    const second = await withMockFetch(
      async () => pngResponse(Buffer.from("bad")),
      async () => runMain(script, [
        "--catalog", changedCatalogPath,
        "--output", output,
        "--manifest", manifestPath,
        "--timeout-ms", "1000"
      ])
    );
    assert.equal(second.exitCode, 1);
    assert.deepEqual(
      await readFile(path.join(output, "card-recover.png")),
      valid
    );
    assert.notEqual(await readFile(manifestPath, "utf8"), oldManifest);

    const recovered = pngBytes("valid");
    const third = await withMockFetch(
      async () => pngResponse(recovered),
      async () => runMain(script, [
        "--catalog", changedCatalogPath,
        "--output", output,
        "--manifest", manifestPath,
        "--timeout-ms", "1000"
      ])
    );
    assert.equal(third.exitCode, 0);
    const thirdManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(thirdManifest.ok, true);
    assert.equal(thirdManifest.counts.downloaded, 1);

    const fourth = await withMockFetch(
      async () => {
        assert.fail("a valid v2 image should resume without a request");
      },
      async () => runMain(script, [
        "--catalog", changedCatalogPath,
        "--output", output,
        "--manifest", manifestPath,
        "--timeout-ms", "1000"
      ])
    );
    assert.equal(fourth.exitCode, 0);
    const fourthManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(fourthManifest.counts.resumed, 1);
  });
});

test("CLI parameter and missing catalog failures are readable", async () => {
  const script = await syncImages;

  assert.throws(
    () => script.parseArguments(["--concurrency", "9"]),
    /between 1 and 8/
  );
  assert.throws(
    () => script.parseArguments(["--timeout-ms", "0"]),
    /between 1 and 3600000/
  );
  assert.throws(
    () => script.parseArguments(["--limit"]),
    /requires a value/
  );
  assert.throws(
    () => script.parseArguments(["--unknown"]),
    /Unknown option/
  );

  await withTempDirectory("sync-images-missing-catalog-", async (directory) => {
    const result = await runMain(script, [
      "--catalog", path.join(directory, "missing.json"),
      "--output", path.join(directory, "images"),
      "--manifest", path.join(directory, "manifest.json")
    ]);
    assert.equal(result.exitCode, 1);
    assert.match(result.errors[0], /catalog file not found/);
  });

  const cli = await runCli(["--concurrency=9"]);
  assert.equal(cli.exitCode, 1);
  assert.match(cli.stderr, /between 1 and 8/);
});

test("safe path containment rejects traversal names", async () => {
  const script = await syncImages;
  assert.equal(script.isSafeImageId("card-001"), true);
  assert.equal(script.isSafeImageId("card.001_alt-A"), true);
  assert.equal(script.isSafeImageId(".hidden"), false);
  assert.equal(script.isSafeImageId("../card"), false);
  assert.equal(script.isSafeImageId("card/other"), false);
  assert.equal(script.isSafeImageId("card\\other"), false);
  assert.equal(script.isSafeImageId(""), false);

  await withTempDirectory("sync-images-no-write-on-url-error-", async (directory) => {
    const catalogPath = await writeCatalog(directory, catalog([
      {
        id: "card-host",
        imageUrl: "https://cmsassets.rgpub.io.evil.test/image.png"
      }
    ]));
    const output = path.join(directory, "images");
    const manifestPath = path.join(directory, "manifest.json");
    const result = await runMain(script, [
      "--catalog", catalogPath,
      "--output", output,
      "--manifest", manifestPath
    ]);
    assert.equal(result.exitCode, 1);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.failures[0].id, "card-host");
    await assert.rejects(readdir(output), { code: "ENOENT" });
  });
});

test("a malformed previous manifest does not block a fresh download", async () => {
  const script = await syncImages;
  await withTempDirectory("sync-images-malformed-manifest-", async (directory) => {
    const catalogPath = await writeCatalog(directory, catalog([
      {
        id: "card-fresh",
        imageUrl:
          "https://cmsassets.rgpub.io/sanity/files/fresh.png"
      }
    ]));
    const output = path.join(directory, "images");
    const manifestPath = path.join(directory, "manifest.json");
    await mkdir(directory, { recursive: true });
    await writeFile(manifestPath, "{not json", "utf8");

    const result = await withMockFetch(
      async () => pngResponse(pngBytes(1)),
      async () => runMain(script, [
        "--catalog", catalogPath,
        "--output", output,
        "--manifest", manifestPath,
        "--timeout-ms", "1000"
      ])
    );
    assert.equal(result.exitCode, 0);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.counts.downloaded, 1);
  });
});
