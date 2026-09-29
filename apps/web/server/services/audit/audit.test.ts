import { describe, expect, it } from 'vitest';
import { auditChanges } from '.';

describe('auditChanges', () => {
  it('lists only changed business fields', () => {
    expect(
      auditChanges(
        { id: '1', updated_at: 'a', rate: '45.00000000', stack: ['TS'], notes: null },
        { id: '1', updated_at: 'b', rate: '47.00000000', stack: ['TS'], notes: null },
      ),
    ).toEqual([{ field: 'rate', from: '45.00000000', to: '47.00000000' }]);
  });

  it('treats inserts as changes from empty', () => {
    expect(auditChanges(null, { id: '1', full_name: 'Andrii', notes: null })).toEqual([
      { field: 'full_name', from: null, to: 'Andrii' },
    ]);
  });

  it('compares arrays and objects by value', () => {
    expect(auditChanges({ stack: ['A', 'B'] }, { stack: ['A', 'C'] })).toHaveLength(1);
  });
});
