import type { Model } from './model';
import type { WriteStats } from './writer';

const TABLE_LABELS: Record<string, string> = {
  company: 'Компанія',
  person: 'Люди',
  payee: 'Одержувачі (ФОП)',
  client: 'Клієнти',
  contract: 'Договори',
  assignment: 'Залучення',
  billing_terms: 'Версії умов клієнту',
  pay_terms: 'Версії умов людині',
  document: 'Документи (CV)',
  period: 'Періоди',
  timesheet: 'Години',
  invoice: 'Інвойси (legacy)',
};

/** import-report.md (spec 8): counts, unmapped names, anomalies with source rows, assignments. */
export function renderReport(input: {
  model: Model;
  stats: WriteStats | null;
  dryRun: boolean;
  problems: string[];
  generatedAt: string;
}): string {
  const { model, stats, dryRun, problems } = input;
  const out: string[] = [];
  out.push(
    `# Звіт імпорту legacy xlsx`,
    '',
    `Згенеровано: ${input.generatedAt}${dryRun ? ' · **dry-run, нічого не записано**' : ''}`,
    '',
  );

  const { people, partners, actSheets, invoiceSheets } = model.unmapped;
  const unmappedCount = people.length + partners.length + actSheets.length + invoiceSheets.length;
  out.push('## Незмаплені імена', '');
  if (unmappedCount === 0) {
    out.push('Немає — усі імена зіставлено через `aliases.json`.', '');
  } else {
    out.push('Додайте їх у `data/legacy/aliases.json` (чернетка — `aliases.draft.json`):', '');
    if (people.length) out.push(`- Люди: ${people.map((n) => `«${n}»`).join(', ')}`);
    if (partners.length)
      out.push(`- Партнери (клієнти): ${partners.map((n) => `«${n}»`).join(', ')}`);
    if (actSheets.length) out.push(`- Аркуші актів без реквізитів: ${actSheets.join(', ')}`);
    if (invoiceSheets.length) out.push(`- Невідомі аркуші інвойсів: ${invoiceSheets.join(', ')}`);
    out.push('');
  }

  if (problems.length) {
    out.push('## Проблеми структури файлів', '', ...problems.map((p) => `- ${p}`), '');
  }

  out.push('## Записи', '');
  if (stats) {
    out.push('| Таблиця | Нових | Змінено | Без змін |', '| --- | --- | --- | --- |');
    for (const [table, s] of Object.entries(stats)) {
      out.push(
        `| ${TABLE_LABELS[table] ?? table} | ${s.inserted} | ${s.updated} | ${s.unchanged} |`,
      );
    }
  } else {
    out.push('Запис не виконувався: спершу усуньте незмаплені імена.');
  }
  out.push('');

  out.push(`## Аномалії (${model.anomalies.length})`, '');
  if (model.anomalies.length === 0) out.push('Немає.');
  for (const a of model.anomalies) out.push(`- \`${a.code}\` · ${a.ref} — ${a.message}`);
  out.push('');

  if (model.invoices.length) {
    out.push(
      '## Legacy-інвойси',
      '',
      '| Номер | Клієнт | Дата | Сума | Рядків |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const i of model.invoices)
      out.push(
        `| ${i.number} | ${i.clientKey} | ${i.issueDate} | ${i.total} ${i.currency} | ${i.lines.length} |`,
      );
    out.push('');
  }

  if (model.timesheets.length) {
    out.push('## Години', '', '| Місяць | Залучення | Години |', '| --- | --- | --- |');
    for (const t of model.timesheets)
      out.push(
        `| ${t.month.slice(0, 7)} | ${t.assignmentRef.replace(/^calc:/, '')} | ${t.hours} |`,
      );
    out.push('');
  }

  out.push(
    '## Залучення та версії умов',
    '',
    '| Людина | Клієнт | Роль | FTE | Період | Версій клієнту | Версій людині |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const a of model.assignments) {
    const b = model.billing.filter((x) => x.assignmentRef === a.ref).length;
    const p = model.pay.filter((x) => x.assignmentRef === a.ref).length;
    out.push(
      `| ${a.personKey} | ${a.clientKey ?? 'внутрішнє'} | ${a.roleTitle ?? '—'} | ${a.fte} | ${a.startsOn.slice(0, 7)} — ${a.endsOn ? a.endsOn.slice(0, 7) : '…'} | ${b} | ${p} |`,
    );
  }
  out.push('');
  return out.join('\n');
}
