// Fast drop-in for csv-reader 1.0.0: run(input) returns exactly what csv-reader returns
// for {text, header} -> {columns, rows, errors}. Dependency-free ES module.
//
// Strategy: one tight charCodeAt loop for the common unquoted path (slice once per
// field at its delimiters, no per-character string building), native indexOf jumps to
// find quoted fields' closing quotes, and a slow path only for fields that actually
// contain doubled quotes, embedded line breaks, stray CRs or junk after a closing quote.
// The unquoted scanner reports through run-scoped scratch variables (no per-field
// array allocation).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const len = text.length;

  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // What the unquoted scanner found: the field's value, how it ended, and how many
  // characters it kept during the scan (quote_junk fires when that count is > 0).
  let uVal = '';
  let uEnded = COMMA;
  let uAdded = 0;

  // Read unquoted characters from pos up to the next comma or line break, starting
  // from `value` ('' for a fresh field, the quoted content for quote junk, '"' for an
  // unterminated quote re-read). Reports through uVal/uEnded/uAdded.
  function readUnquoted(value, added) {
    let start = pos;
    let val = value;
    let kept = added;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        // comma
        if (pos > start) val = val === '' ? text.slice(start, pos) : val + text.slice(start, pos);
        pos += 1;
        uVal = val;
        uEnded = COMMA;
        uAdded = kept + (pos - 1 - start);
        return;
      }
      if (c === 10) {
        // LF
        if (pos > start) val = val === '' ? text.slice(start, pos) : val + text.slice(start, pos);
        pos += 1;
        line += 1;
        uVal = val;
        uEnded = LINE_BREAK;
        uAdded = kept + (pos - 1 - start);
        return;
      }
      if (c === 13) {
        // CR: CRLF ends the record, a lone CR is dropped (stray_cr).
        if (text.charCodeAt(pos + 1) === 10) {
          if (pos > start) val = val === '' ? text.slice(start, pos) : val + text.slice(start, pos);
          pos += 2;
          line += 1;
          uVal = val;
          uEnded = LINE_BREAK;
          uAdded = kept + (pos - 2 - start);
          return;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (pos > start) val = val === '' ? text.slice(start, pos) : val + text.slice(start, pos);
        kept += pos - start;
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    if (pos > start) val = val === '' ? text.slice(start, pos) : val + text.slice(start, pos);
    uVal = val;
    uEnded = END;
    uAdded = kept + (pos - start);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended = COMMA;
    let quoted = false;
    while (ended === COMMA) {
      quoted = text.charCodeAt(pos) === 34;
      let value;
      if (!quoted) {
        readUnquoted('', 0);
        value = uVal;
        ended = uEnded;
      } else {
        // Quoted field: opening quote at pos.
        const open = pos;
        const openLine = line;
        pos += 1;
        let q = text.indexOf('"', pos);
        let doubled = false;
        while (q !== -1 && text.charCodeAt(q + 1) === 34) {
          doubled = true;
          q = text.indexOf('"', q + 2);
        }
        if (q === -1) {
          // The quote never closes: it is a literal character, and the text after it
          // is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          readUnquoted('"', 0);
          value = uVal;
          ended = uEnded;
        } else {
          // Fast path: no doubled quotes and no line break inside the quotes.
          const nl = text.indexOf('\n', open + 1);
          const cr = text.indexOf('\r', open + 1);
          const hasBreak = (nl !== -1 && nl < q) || (cr !== -1 && cr < q);
          if (!doubled && !hasBreak) {
            value = text.slice(open + 1, q);
          } else {
            // Slow path: build the value, "" -> ", CRLF/lone CR -> LF, count lines.
            let v = '';
            let i = open + 1;
            while (i < q) {
              const c = text.charCodeAt(i);
              if (c === 34) {
                v += '"';
                i += 2;
              } else if (c === 13) {
                v += '\n';
                line += 1;
                i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
              } else if (c === 10) {
                v += '\n';
                line += 1;
                i += 1;
              } else {
                // Copy a run of plain characters at once.
                let j = i + 1;
                while (j < q) {
                  const d = text.charCodeAt(j);
                  if (d === 34 || d === 13 || d === 10) break;
                  j += 1;
                }
                v += text.slice(i, j);
                i = j;
              }
            }
            value = v;
          }
          pos = q + 1;
          if (pos >= len) {
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = LINE_BREAK;
            } else {
              // What follows the closing quote is appended as it stands.
              readUnquoted(value, 0);
              if (uAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              value = uVal;
              ended = uEnded;
            }
          }
        }
      }
      fields.push(value);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
