import { describe, expect, it } from 'vitest';
import { formDataToObject, nestPrefixed } from './form-data';

describe('formDataToObject', () => {
  it('keeps single values, collects repeated keys and drops React action fields', () => {
    const fd = new FormData();
    fd.append('name', 'Andrii');
    fd.append('stack', 'AWS');
    fd.append('stack', 'GCP');
    fd.append('$ACTION_ID_abc', '');
    expect(formDataToObject(fd)).toEqual({ name: 'Andrii', stack: ['AWS', 'GCP'] });
  });
});

describe('nestPrefixed', () => {
  it('nests only the listed prefixes', () => {
    expect(
      nestPrefixed(
        {
          personId: 'p',
          'billing.type': 'hourly',
          'billing.rate': '47',
          'pay.type': 'fixed',
          'x.y': 1,
        },
        ['billing', 'pay'],
      ),
    ).toEqual({
      personId: 'p',
      'x.y': 1,
      billing: { type: 'hourly', rate: '47' },
      pay: { type: 'fixed' },
    });
  });
});
