import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { Geist, Manrope } from 'next/font/google';
import Script from 'next/script';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeSync } from '@/components/v2/theme-sync';
import { cn } from '@/lib/utils';
import { getUiPrefs } from '@/server/ui-prefs';
import './globals.css';

const geist = Geist({ subsets: ['latin', 'cyrillic'], variable: '--font-sans' });
const manrope = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-display' });

export const metadata: Metadata = {
  title: 'Tally',
  description: 'Back-office Syntora.Tech',
};

// Runs before paint so a "system" theme never flashes light; ThemeSync follows OS changes.
const SYSTEM_THEME_SCRIPT = `document.documentElement.classList.toggle('dark',window.matchMedia('(prefers-color-scheme: dark)').matches)`;

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
      <body className="min-h-screen antialiased">
        {v2 && theme === 'system' && (
          <Script id="system-theme" strategy="beforeInteractive">
            {SYSTEM_THEME_SCRIPT}
          </Script>
        )}
        {v2 && <ThemeSync theme={theme} />}
        <NextIntlClientProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-right" {...(v2 ? { theme } : {})} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
