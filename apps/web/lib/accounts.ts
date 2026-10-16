/** Accounts to offer in lists and pickers: hidden ones only when already chosen (A-106). */
export function shownAccounts<T extends { account: { id: string; isHidden: boolean } }>(
  rows: readonly T[],
  keep?: string | null,
): T[] {
  return rows.filter((r) => !r.account.isHidden || r.account.id === keep);
}
