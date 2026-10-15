'use client';

import { ChevronsUpDown, LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { LOCALES, type Locale } from '@/i18n/locales';
import { THEMES, type Theme } from '@/lib/ui-prefs';
import { setLocaleAction } from '@/server/actions/locale';
import { setThemeAction, setUiVersionAction } from '@/server/actions/ui-prefs';

const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', uk: 'Українська' };

export type UserMenuProps = {
  email: string;
  roleLabel: string;
  locale: Locale;
  theme: Theme;
  signOutAction: () => Promise<void>;
};

export function UserMenu({ email, roleLabel, locale, theme, signOutAction }: UserMenuProps) {
  const t = useTranslations('nav');
  const [pending, startTransition] = useTransition();
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" aria-label={t('userMenu')} disabled={pending} />}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success text-xs font-semibold text-success-foreground dark:bg-neon dark:text-black">
              {initials}
            </span>
            <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
              <span
                className="truncate text-sm font-medium text-white"
                data-testid="current-user-email"
              >
                {email}
              </span>
              <span className="truncate text-xs text-sidebar-foreground/70">{roleLabel}</span>
            </span>
            <ChevronsUpDown className="ml-auto size-4 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={locale}
                onValueChange={(next: string) => {
                  startTransition(() => setLocaleAction(next));
                }}
              >
                {LOCALES.map((l) => (
                  <DropdownMenuRadioItem key={l} value={l} closeOnClick>
                    {LANGUAGE_NAMES[l]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('theme')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(next: string) => {
                  startTransition(() => setThemeAction(next));
                }}
              >
                {THEMES.map((th) => (
                  <DropdownMenuRadioItem key={th} value={th} closeOnClick>
                    {t(`themes.${th}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked
              closeOnClick
              onCheckedChange={() => {
                startTransition(() => setUiVersionAction('v1'));
              }}
            >
              {t('newDesign')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                startTransition(() => signOutAction());
              }}
            >
              <LogOut />
              {t('signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
