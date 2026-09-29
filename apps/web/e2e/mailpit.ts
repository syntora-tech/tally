const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

type MailpitSearch = { messages: { ID: string; Created: string }[] };
type MailpitMessage = { HTML: string; Text: string };

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

export async function countMessagesTo(email: string): Promise<number> {
  const res = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
  );
  const body = (await res.json()) as MailpitSearch;
  return body.messages.length;
}

/** Polls Mailpit for the latest Supabase magic link sent to `email`. */
export async function waitForMagicLink(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    );
    const { messages } = (await res.json()) as MailpitSearch;
    const latest = messages[0];
    if (latest) {
      const msg = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${latest.ID}`)
      ).json()) as MailpitMessage;
      const match = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(msg.HTML);
      if (match?.[1]) return match[1].replaceAll('&amp;', '&');
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No magic link for ${email} within ${timeoutMs}ms`);
}
