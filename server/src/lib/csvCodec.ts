export interface CsvRecord {
  line: number;
  fields: string[];
}

export function parseCsv(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endField = (): void => {
    fields.push(field);
    field = '';
    quoted = false;
  };

  const endRecord = (): void => {
    endField();
    const blank = fields.length === 1 && fields[0].trim() === '';
    if (!blank) records.push({ line: recordLine, fields });
    fields = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '' && !quoted) {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (ch === ',') {
      endField();
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
      continue;
    }
    field += ch;
  }

  if (inQuotes || field !== '' || fields.length > 0 || quoted) endRecord();
  return records;
}

function escapeField(value: string): string {
  const needsQuotes = /[",\r\n]/.test(value) || value !== value.trim();
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  if (rows.length === 0) return '';
  return rows.map((row) => row.map(escapeField).join(',')).join('\n') + '\n';
}