const SENSITIVE_FIELD = /(?:token|secret|password|authorization)/iu;
const CREDENTIAL_TEXT = /(["']?)\b(authorization|resumeToken|password|secret)\b\1(\s*[:=]\s*)('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|(?:(?:Bearer|Basic)\s+)?[^\s,;}&]+)/giu;
const REDACTED = "[redacted]";

/** Recursively replaces sensitive field values while preserving log shape. */
export function redactDiagnosticValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => redactDiagnosticValue(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    const redactedField = redactDiagnosticValue(field, seen);
    result[key] = SENSITIVE_FIELD.test(key) ? REDACTED
      : typeof redactedField === "string" ? redactCredentialText(redactedField) : redactedField;
  }
  return result;
}

/** Returns a plain JSON-safe value suitable for local diagnostic storage. */
export function sanitizeDiagnosticRecord(value: unknown): Record<string, unknown> {
  const redacted = redactDiagnosticValue(value);
  if (redacted === null || typeof redacted !== "object" || Array.isArray(redacted)) return {};
  try {
    const serialized = JSON.stringify(redacted);
    const parsed: unknown = JSON.parse(serialized);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return redactCredentialText(error.message);
  if (typeof error === "string") return redactCredentialText(error);
  try { return redactCredentialText(JSON.stringify(redactDiagnosticValue(error))); }
  catch { return "未知错误"; }
}

export function redactCredentialText(value: string): string {
  return value.replace(CREDENTIAL_TEXT, (_match, quote, field, separator) => {
    const replacement = quote === '"' ? `"${REDACTED}"` : quote === "'" ? `'${REDACTED}'` : REDACTED;
    return `${quote}${field}${quote}${separator}${replacement}`;
  });
}

export { REDACTED };
