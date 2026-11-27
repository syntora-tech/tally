/** Not paid in full, and the act of the rest (if any) is still an unpaid draft (A-099, A-142). */
export function adjustableAfterClose(i: {
  item: { status: string };
  acts: readonly { status: string; isRest: boolean; rateLocked: boolean }[];
}) {
  return (
    i.item.status !== 'paid' &&
    i.acts.every((a) => !a.isRest || (a.status === 'draft' && !a.rateLocked))
  );
}
