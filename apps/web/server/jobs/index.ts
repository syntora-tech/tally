import 'server-only';
import { docs } from '@googleapis/docs';
import { drive } from '@googleapis/drive';
import { JWT } from 'google-auth-library';
import { after } from 'next/server';
import { getDb } from '../db/client';
import { driveConfig, getServerEnv } from '../env';
import { GoogleDocsRenderer, HtmlRenderer, type DocumentRenderer } from '../render/renderers';
import { getDocumentStorage } from '../storage';
import { DriveStorage } from '../storage/drive-storage';
import { renderInvoiceHandler } from './render-invoice';
import { runNextJob, type JobHandler } from './worker';

let handlers: Record<string, JobHandler> | undefined;

function getRenderer(): DocumentRenderer {
  const env = getServerEnv();
  const storage = getDocumentStorage();
  if (env.STORAGE_DRIVER === 'local' || !(storage instanceof DriveStorage)) {
    return new HtmlRenderer();
  }
  const { email, privateKey } = driveConfig(env);
  const auth = new JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/documents'],
  });
  return new GoogleDocsRenderer(
    drive({ version: 'v3', auth }).files,
    docs({ version: 'v1', auth }).documents,
    storage,
  );
}

function getHandlers(): Record<string, JobHandler> {
  if (handlers) return handlers;
  const env = getServerEnv();
  handlers = {
    render_invoice: renderInvoiceHandler({
      renderer: getRenderer(),
      storage: getDocumentStorage(),
      templates: {
        invoice_hourly: env.GOOGLE_TEMPLATE_INVOICE_HOURLY_ID,
        invoice_fixed: env.GOOGLE_TEMPLATE_INVOICE_FIXED_ID,
      },
    }),
  };
  return handlers;
}

/** The `jobs` cron: one job per call (spec 10.4). */
export function runJobsOnce() {
  return runNextJob(getDb(), getHandlers());
}

/**
 * A single document is rendered right after the response instead of waiting for the cron (7.1);
 * failures stay queued for the cron's retries.
 */
export function runJobsAfterResponse() {
  after(async () => {
    try {
      await runJobsOnce();
    } catch (error) {
      console.error('Job run after response failed', error);
    }
  });
}
