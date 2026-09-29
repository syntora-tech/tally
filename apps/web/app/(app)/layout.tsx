import { AppSidebar } from '@/components/app-sidebar';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { ALL_ROLES, navItemsFor, ROLE_LABELS } from '@/lib/navigation';
import { signOut } from '@/server/actions/auth';
import { requireRole } from '@/server/request-context';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireRole(ALL_ROLES);

  return (
    <SidebarProvider>
      <AppSidebar
        items={navItemsFor(actor.role)}
        email={actor.email}
        roleLabel={ROLE_LABELS[actor.role]}
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
