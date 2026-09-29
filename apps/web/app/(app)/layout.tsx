import { requireUserContext } from '@/server/request-context';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUserContext();
  return <>{children}</>;
}
