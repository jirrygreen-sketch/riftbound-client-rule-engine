#!/usr/bin/env node
// RIFT-1133: pull queued player issue reports from the game server and file
// them as Zira issues.
//
// The public game server cannot reach the internal Zira, so it only keeps
// reports in memory (RIFT-1132). This script runs on a machine inside the
// network (launchd, every few minutes), creates one Zira issue per report with
// the client log and match log attached, and only then acknowledges the report
// so the server drops it. A local state file maps reportId -> issue key, so a
// failed acknowledgement is retried without filing a duplicate issue.
//
// Credentials are never printed: the pull token is read from a 0600 file and
// the Zira Authorization header is read at run time from an existing local
// configuration file.

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_CONFIG_PATH = path.join(homedir(), ".config", "riftbound", "issue-puller.json");

const DEFAULTS = Object.freeze({
  serverUrl: "https://rift-beta.xjerryx.com",
  pullTokenFile: path.join(homedir(), ".config", "riftbound", "issue-pull-token"),
  stateFile: path.join(homedir(), ".local", "state", "riftbound", "issue-puller.json"),
  ziraBaseUrl: "https://zira.intra.zeron.ai",
  // Where the Zira Authorization header comes from: a JSON file and a dotted
  // path inside it (the Claude Code MCP configuration by default).
  ziraAuthFile: path.join(homedir(), ".claude.json"),
  ziraAuthPath: "mcpServers.zira.headers.Authorization",
  projectKey: "RIFT",
  issueType: "Task",
  parentKey: "RIFT-1046",
  labels: ["user-report", "m1"],
  batchSize: 10,
  requestTimeoutMs: 30_000
});

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ERROR_LINES = 20;

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  let overrides = {};
  try {
    overrides = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`cannot read ${configPath}: ${error.message}`);
  }
  return { ...DEFAULTS, ...overrides };
}

/** Reads a secret only from a regular file that no group/other can access. */
export async function readSecretFile(file, label) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error(`${label} ${file} is not a regular file`);
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`${label} ${file} has mode ${(info.mode & 0o777).toString(8)}; chmod 600 it first`);
  }
  const value = (await readFile(file, "utf8")).trim();
  if (value.length === 0) throw new Error(`${label} file ${file} is empty`);
  return value;
}

export async function readZiraAuthorization(config) {
  const json = JSON.parse(await readFile(config.ziraAuthFile, "utf8"));
  const value = config.ziraAuthPath.split(".").reduce((node, key) => node?.[key], json);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`no Zira Authorization at ${config.ziraAuthPath} in ${config.ziraAuthFile}`);
  }
  return value;
}

export async function loadState(file) {
  try {
    const state = JSON.parse(await readFile(file, "utf8"));
    return { filed: typeof state?.filed === "object" && state.filed !== null ? state.filed : {} };
  } catch (error) {
    if (error?.code === "ENOENT") return { filed: {} };
    throw new Error(`cannot read state ${file}: ${error.message}`);
  }
}

export async function saveState(file, state) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function requestJson(fetchImpl, url, init, timeoutMs) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${new URL(url).pathname} -> HTTP ${response.status}`);
  }
  return text.length === 0 ? null : JSON.parse(text);
}

function isReport(value) {
  return value !== null && typeof value === "object" && value.schemaVersion === 1 &&
    typeof value.reportId === "string" && REPORT_ID.test(value.reportId) &&
    typeof value.title === "string" && Array.isArray(value.clientLog);
}

function oneLine(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Zira issue fields for one report; log bodies travel as attachments. */
export function issueFieldsFor(report, config) {
  const client = report.client ?? {};
  const player = report.player ?? {};
  const errors = report.clientLog
    .filter(entry => entry?.level === "error" || entry?.level === "warn")
    .slice(-MAX_ERROR_LINES)
    .map(entry => `- ${oneLine(entry.at, 32)} [${oneLine(entry.level, 8)}] ${oneLine(entry.source, 64)}：${oneLine(entry.message, 300)}`);
  const match = report.matchLog;
  const lines = [
    `玩家问题上报（RIFT-1131/1132/1133 自动建单），报告编号 ${report.reportId}。`,
    "",
    "**玩家描述**",
    report.description?.trim() ? report.description.trim() : "（未填写）",
    "",
    "**环境**",
    `- 平台：${oneLine(client.platform, 32)}，客户端版本：${oneLine(client.appVersion, 64)}`,
    `- 服务地址：${oneLine(client.serverUrl, 200)}`,
    `- 浏览器标识：${oneLine(client.userAgent, 300)}`,
    `- 语言：${oneLine(client.locale, 32)}，上报时间：${oneLine(report.createdAt, 40)}`,
    `- 玩家：${oneLine(player.name ?? "未知", 64)}，房间：${oneLine(player.roomId ?? "无", 64)}，座位：${oneLine(player.playerId ?? "无", 64)}`,
    "",
    "**附件**",
    `- client-log.json：客户端日志 ${report.clientLog.length} 条`,
    match ? `- match-log.json：对局日志 ${match.entries?.length ?? 0} 条（房间 ${oneLine(match.roomId, 64)}，对局 ${oneLine(match.matchId ?? "无", 64)}）`
      : "- 不在对局中，没有对局日志",
    "",
    `**最近的告警与错误（最多 ${MAX_ERROR_LINES} 条）**`,
    ...(errors.length > 0 ? errors : ["（无）"])
  ];
  return {
    projectKey: config.projectKey,
    issueType: config.issueType,
    summary: `【玩家上报】${oneLine(report.title, 120)}`,
    description: lines.join("\n"),
    labels: [...config.labels],
    parentKey: config.parentKey
  };
}

export function attachmentsFor(report) {
  const files = [{
    name: "client-log.json",
    body: JSON.stringify({ reportId: report.reportId, client: report.client, clientLog: report.clientLog }, null, 2)
  }];
  if (report.matchLog) {
    files.push({ name: "match-log.json", body: JSON.stringify(report.matchLog, null, 2) });
  }
  return files;
}

export function createZiraClient({ baseUrl, authorization, fetchImpl = fetch, timeoutMs = 30_000 }) {
  const headers = { Authorization: authorization, Accept: "application/json" };
  return {
    async createIssue(fields) {
      const body = {
        fields: {
          project: { key: fields.projectKey },
          issuetype: { name: fields.issueType },
          summary: fields.summary,
          description: fields.description,
          labels: fields.labels,
          ...(fields.parentKey ? { parent: { key: fields.parentKey } } : {})
        }
      };
      const created = await requestJson(fetchImpl, `${baseUrl}/api/v1/issues`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }, timeoutMs);
      if (typeof created?.key !== "string") throw new Error("Zira create issue returned no key");
      return created.key;
    },
    async attach(issueKey, file) {
      const form = new FormData();
      form.append("file", new Blob([file.body], { type: "application/json" }), file.name);
      await requestJson(fetchImpl, `${baseUrl}/api/v1/issues/${encodeURIComponent(issueKey)}/attachments`, {
        method: "POST",
        headers: { ...headers, "X-Atlassian-Token": "no-check" },
        body: form
      }, timeoutMs);
    }
  };
}

export function createReportServerClient({ serverUrl, pullToken, fetchImpl = fetch, timeoutMs = 30_000 }) {
  const base = serverUrl.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${pullToken}`, Accept: "application/json" };
  return {
    async pending(limit) {
      const value = await requestJson(fetchImpl, `${base}/api/issue-reports/pending?limit=${limit}`,
        { method: "GET", headers }, timeoutMs);
      if (!Array.isArray(value?.reports)) throw new Error("pending response has no reports array");
      return value.reports;
    },
    async ack(reportIds) {
      if (reportIds.length === 0) return 0;
      const value = await requestJson(fetchImpl, `${base}/api/issue-reports/ack`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ reportIds })
      }, timeoutMs);
      return typeof value?.removed === "number" ? value.removed : 0;
    }
  };
}

/** Attachment names already uploaded for a filed report (legacy `attached: true` means all). */
function uploadedAttachments(record, report) {
  if (record.attached === true) return new Set(attachmentsFor(report).map(file => file.name));
  return new Set(Array.isArray(record.uploaded) ? record.uploaded : []);
}

/**
 * One pull cycle. Returns a summary; never logs report content.
 * A report is acknowledged only once its issue exists and every attachment is
 * uploaded; a report filed earlier resumes with only its missing attachments,
 * and never gets a second issue.
 */
export async function runOnce({ server, zira, state, saveStateFn, config, log = () => undefined }) {
  const reports = await server.pending(config.batchSize);
  const toAck = [];
  const summary = { fetched: reports.length, filed: 0, resumed: 0, reacknowledged: 0, skipped: 0, failed: 0 };
  for (const report of reports) {
    if (!isReport(report)) {
      summary.skipped += 1;
      log(`skip malformed report ${oneLine(report?.reportId, 40)}`);
      continue;
    }
    let record = state.filed[report.reportId];
    const isNew = record === undefined;
    try {
      if (isNew) {
        const issueKey = await zira.createIssue(issueFieldsFor(report, config));
        // Remember the issue before attaching, so a later failure never leads
        // to a second issue for the same report.
        record = { issueKey, filedAt: new Date().toISOString(), uploaded: [] };
        state.filed[report.reportId] = record;
        await saveStateFn(state);
      }
      const done = uploadedAttachments(record, report);
      const missing = attachmentsFor(report).filter(file => !done.has(file.name));
      for (const file of missing) {
        await zira.attach(record.issueKey, file);
        done.add(file.name);
        record.uploaded = [...done];
        delete record.attached;
        await saveStateFn(state);
      }
      toAck.push(report.reportId);
      if (isNew) {
        summary.filed += 1;
        log(`filed ${report.reportId} as ${record.issueKey}`);
      } else if (missing.length > 0) {
        summary.resumed += 1;
        log(`resumed ${report.reportId} on ${record.issueKey} (+${missing.length} attachment)`);
      } else {
        summary.reacknowledged += 1;
      }
    } catch (error) {
      summary.failed += 1;
      log(`failed ${report.reportId}: ${error.message}`);
    }
  }
  if (toAck.length > 0) {
    await server.ack(toAck);
    log(`acknowledged ${toAck.length}`);
  }
  return summary;
}

async function main() {
  const configPath = process.argv[2] ?? DEFAULT_CONFIG_PATH;
  const config = await loadConfig(configPath);
  const log = message => console.log(`${new Date().toISOString()} ${message}`);
  const server = createReportServerClient({
    serverUrl: config.serverUrl,
    pullToken: await readSecretFile(config.pullTokenFile, "pull token"),
    timeoutMs: config.requestTimeoutMs
  });
  const zira = createZiraClient({
    baseUrl: config.ziraBaseUrl,
    authorization: await readZiraAuthorization(config),
    timeoutMs: config.requestTimeoutMs
  });
  const state = await loadState(config.stateFile);
  const summary = await runOnce({
    server, zira, state, config, log,
    saveStateFn: next => saveState(config.stateFile, next)
  });
  log(`done ${JSON.stringify(summary)}`);
  if (summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`${new Date().toISOString()} error ${error.message}`);
    process.exitCode = 1;
  });
}
