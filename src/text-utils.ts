// Catalog "Sales description" values imported from the PandaDoc export carry
// the source editor's HTML (<p>, <br>, <span class="redactor-invisible-space">).
// The client-facing proposal printed those tags literally, so flatten markup
// to plain text wherever a stored description is shown to a customer.
export function htmlToPlainText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  if (!/<[a-z!/][^>]*>/i.test(value)) {
    return value;
  }
  return value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Mail-provider failures come back as "Email provider returned 422: {json}".
// Pull the human message out of the JSON when there is one so a status line
// reads as a sentence, not a payload.
export function plainEmailFailureReason(raw: string | undefined): string {
  if (!raw) {
    return "no email provider is configured for this workspace";
  }
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { message?: string };
      if (parsed.message) {
        return parsed.message;
      }
    } catch {
      // fall through to the raw text
    }
  }
  return raw;
}
