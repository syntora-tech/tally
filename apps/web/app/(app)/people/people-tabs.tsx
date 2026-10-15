import { getTranslations } from 'next-intl/server';
import { TabsNav } from '@/components/v2/tabs-nav';

/** v2: people and payout recipients are two tabs of one directory. */
export async function PeopleTabs({ active }: { active: 'people' | 'payees' }) {
  const [t, tp] = await Promise.all([getTranslations('people'), getTranslations('payees')]);
  return (
    <TabsNav
      label={t('title')}
      active={active}
      tabs={[
        { key: 'people', label: t('title'), href: '/people' },
        { key: 'payees', label: tp('title'), href: '/people/payees' },
      ]}
    />
  );
}
