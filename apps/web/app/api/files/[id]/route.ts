import { document } from '@tally/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { withUser } from '@/server/db/with-user';
import { getSessionActor } from '@/server/request-context';
import { getDb } from '@/server/db/client';
import { getDocumentStorage } from '@/server/storage';

/** Opens a document's file; access is decided by RLS on `document`, never by the URL. */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/files/[id]'>) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return new NextResponse(null, { status: 404 });

  const actor = await getSessionActor();
  if (!actor?.role) return new NextResponse(null, { status: 401 });

  const [doc] = await withUser(getDb(), { claims: actor.claims, via: 'ui' }, (tx) =>
    tx
      .select({ key: document.driveFileId, fileName: document.fileName, url: document.url })
      .from(document)
      .where(eq(document.id, id)),
  );
  if (!doc) return new NextResponse(null, { status: 404 });
  if (!doc.key) {
    return doc.url ? NextResponse.redirect(doc.url) : new NextResponse(null, { status: 404 });
  }

  const storage = getDocumentStorage();
  const viewUrl = storage.viewUrl(doc.key);
  if (viewUrl) return NextResponse.redirect(viewUrl);

  const file = await storage.download(doc.key);
  if (!file) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(file.data), {
    headers: {
      'content-type': file.mimeType,
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName ?? 'file')}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      // Uploaded and rendered HTML must not run scripts on the app origin.
      'content-security-policy': 'sandbox',
    },
  });
}
