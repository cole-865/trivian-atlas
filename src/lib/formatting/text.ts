function titleCaseWord(word: string) {
  return word.replace(/[A-Za-z]+('[A-Za-z]+)?/g, (segment) => {
    const lower = segment.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

export function toTitleCase(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  return text
    .split(/\s+/)
    .map((word) => titleCaseWord(word))
    .join(" ");
}

export function titleCaseOrNull(value: string | null | undefined) {
  const formatted = toTitleCase(value);
  return formatted || null;
}
