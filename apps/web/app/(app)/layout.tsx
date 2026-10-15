import { AppSidebar } from '@/components/app-sidebar';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { V2AppHeader } from '@/components/v2/app-header';
import { V2AppSidebar } from '@/components/v2/app-sidebar';
import { getLocale, getTranslations } from 'next-intl/server';
import { ALL_ROLES, navItemsFor, navSectionsFor } from '@/lib/navigation';
import { signOut } from '@/server/actions/auth';
import { requireRole } from '@/server/request-context';
import { getUiPrefs } from '@/server/ui-prefs';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireRole(ALL_ROLES);
  const t = await getTranslations('roles');
  const locale = await getLocale();
  const { version, theme } = await getUiPrefs();

  if (version === 'v2') {
    return (
      <SidebarProvider>
        <V2AppSidebar
          sections={navSectionsFor(actor.role)}
          user={{
            email: actor.email,
            roleLabel: t(actor.role),
            locale,
            theme,
            signOutAction: signOut,
          }}
        />
        <SidebarInset className="min-w-0">
          <V2AppHeader items={navItemsFor(actor.role)} />
          <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar
        items={navItemsFor(actor.role)}
        email={actor.email}
        roleLabel={t(actor.role)}
        locale={locale}
        signOutAction={signOut}
      />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm text-muted-foreground">Syntora.Tech</span>
        </header>
        <div className="flex-1 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
