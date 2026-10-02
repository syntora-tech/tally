import { CRYPTO_NETWORK_NAMES, CRYPTO_NETWORKS } from '@tally/domain';
import type { ComponentProps } from 'react';
import { NativeSelect } from '@/components/form-field';

const OPTIONS = CRYPTO_NETWORKS.map((n) => ({
  value: n,
  label: `${CRYPTO_NETWORK_NAMES[n]} (${n})`,
}));

/** The fixed network list (A-060); `placeholder` adds an empty choice for optional fields. */
export function NetworkSelect(props: Omit<ComponentProps<typeof NativeSelect>, 'options'>) {
  return <NativeSelect options={OPTIONS} {...props} />;
}
