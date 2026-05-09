function stringifyErrorPart(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatWorkerError(err: unknown) {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }

  if (err && typeof err === "object") {
    const candidate = err as {
      code?: unknown;
      details?: unknown;
      error?: unknown;
      hint?: unknown;
      message?: unknown;
    };

    const message = stringifyErrorPart(candidate.message);
    const details = stringifyErrorPart(candidate.details);
    const hint = stringifyErrorPart(candidate.hint);
    const code = stringifyErrorPart(candidate.code);
    const error = stringifyErrorPart(candidate.error);

    const parts = [message, details, hint, code ? `Code: ${code}` : null, error]
      .filter((part): part is string => Boolean(part));

    if (parts.length > 0) return parts.join(" ");

    return stringifyErrorPart(candidate) ?? "Unknown error";
  }

  return stringifyErrorPart(err) ?? "Unknown error";
}
