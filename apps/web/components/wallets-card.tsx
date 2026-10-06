import { CRYPTO_NETWORK_NAMES, isCryptoNetwork } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { AddDetails, CollapsibleCard } from '@/components/collapsible-card';
import {
  AddWalletForm,
  WalletActiveToggle,
  type WalletOwnerField,
} from '@/components/wallet-forms';
import type { ServiceContext } from '@/server/services/context';
import { listWallets } from '@/server/services/wallets';

/** Crypto wallets of a person or client (finance+, A-060); used to identify Ledger counterparties. */
export async function WalletsCard({
  ctx,
  owner,
}: {
  ctx: ServiceContext;
  owner: WalletOwnerField;
}) {
  const wallets = (await listWallets.run(ctx, { [owner.name]: owner.value })).unwrapOr([]);
  const t = await getTranslations('wallets');
  return (
    <CollapsibleCard title={t('title')} count={wallets.length} open={wallets.length > 0}>
      {wallets.length > 0 && (
        <ul className="flex flex-col divide-y text-sm">
          {wallets.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2 py-2">
              <Badge variant={w.isActive ? 'secondary' : 'outline'}>
                {isCryptoNetwork(w.network) ? CRYPTO_NETWORK_NAMES[w.network] : w.network}
              </Badge>
              <code
                className={`break-all font-mono text-xs ${w.isActive ? '' : 'text-muted-foreground line-through'}`}
              >
                {w.address}
              </code>
              {w.label && <span className="text-muted-foreground">{w.label}</span>}
              <span className="ml-auto">
                <WalletActiveToggle id={w.id} label={w.label} isActive={w.isActive} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <AddDetails label={t('add')} open={wallets.length === 0}>
        <AddWalletForm owner={owner} />
      </AddDetails>
    </CollapsibleCard>
  );
}
