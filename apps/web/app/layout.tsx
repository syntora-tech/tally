import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { Geist, Manrope } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getUiPrefs } from '@/server/ui-prefs';
import './globals.css';

const geist = Geist({ subsets: ['latin', 'cyrillic'], variable: '--font-sans' });
const manrope = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-display' });

export const metadata: Metadata = {
  title: 'Tally',
  description: 'Back-office Syntora.Tech',
};

// Runs before paint so a "system" theme never flashes light; toggles on OS changes too.
const SYSTEM_THEME_SCRIPT = `(function(){var m=window.matchMedia('(prefers-color-scheme: dark)');function a(){document.documentElement.classList.toggle('dark',m.matches)}a();m.addEventListener('change',a)})()`;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const { version, theme } = await getUiPrefs();
  const v2 = version === 'v2';
  return (
    <html
      lang={locale}
      className={cn(
        'font-sans',
        geist.variable,
        v2 && ['v2', manrope.variable],
        v2 && theme === 'dark' && 'dark',
      )}
      suppressHydrationWarning={v2}
    >
      {v2 && theme === 'system' ? (
        <head>
          <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
        </head>
      ) : null}
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-right" {...(v2 ? { theme } : {})} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
