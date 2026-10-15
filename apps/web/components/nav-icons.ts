import {
  Building2,
  CalendarRange,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Landmark,
  Plane,
  ScrollText,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { NavIcon } from '@/lib/navigation';

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  people: Users,
  clients: Building2,
  periods: CalendarRange,
  invoices: FileText,
  payroll: Wallet,
  acts: ScrollText,
  ledger: Landmark,
  trips: Plane,
  documents: FolderOpen,
  settings: Settings,
};
