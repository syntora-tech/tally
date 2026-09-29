import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv-parse';

describe('parseCsv', () => {
  it('reads the exported hours template with a BOM', () => {
    const rows = parseCsv(
      '\uFEFFassignment_id,person,client,role,hours\r\nabc,"Pavlo, Jr.",Boosty,Dev,176\r\n',
    );
    expect(rows).toEqual([
      { assignment_id: 'abc', person: 'Pavlo, Jr.', client: 'Boosty', role: 'Dev', hours: '176' },
    ]);
  });

  it('accepts semicolons, decimal commas in quotes and escaped quotes', () => {
    const rows = parseCsv('Assignment_ID;Hours;Note\nx;"3,15";"say ""hi"""\n\n');
    expect(rows).toEqual([{ assignment_id: 'x', hours: '3,15', note: 'say "hi"' }]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
