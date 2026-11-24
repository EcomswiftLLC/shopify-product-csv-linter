'use strict';

/**
 * Minimal RFC 4180 CSV parser that keeps track of the physical line each
 * record starts on, so lint messages can point at the row you see in an editor.
 *
 * Handles: UTF-8 BOM, CRLF / LF / CR line endings, quoted fields with embedded
 * commas, quotes ("") and newlines. Reports an unterminated quote instead of
 * silently swallowing the rest of the file.
 */
function parseCsv(input) {
  let text = String(input);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let quotedField = false;
  let line = 1;
  let recordLine = 1;
  let quoteOpenedAt = null;
  let sawAny = false;

  const endField = () => {
    fields.push(field);
    field = '';
    quotedField = false;
  };
  const endRecord = () => {
    endField();
    // A completely blank line is not a record.
    if (!(fields.length === 1 && fields[0] === '' && !sawAny)) {
      records.push({ line: recordLine, fields });
    }
    fields = [];
    sawAny = false;
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
    if (ch === '"' && field === '' && !quotedField) {
      inQuotes = true;
      quotedField = true;
      sawAny = true;
      quoteOpenedAt = line;
    } else if (ch === ',') {
      sawAny = true;
      endField();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      sawAny = true;
      field += ch;
    }
  }
  if (inQuotes) {
    return { records, unterminatedQuoteLine: quoteOpenedAt };
  }
  if (field !== '' || fields.length > 0 || sawAny) endRecord();
  return { records, unterminatedQuoteLine: null };
}

module.exports = { parseCsv };
