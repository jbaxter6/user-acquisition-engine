// Pulls the server's `error` field out of api/client's "400 Bad Request: {json}".
export function apiErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const body = msg.match(/^\d{3} [^:]*: ([\s\S]*)$/)?.[1];
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // not JSON — fall through to the raw message
    }
  }
  return msg;
}
