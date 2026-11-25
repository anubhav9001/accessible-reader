import type { BookInfo } from '../shared/api';
import { openDialog } from './open-dialog';

/** One part of an information dialog: a heading and a table of label and value. */
export interface InfoSection {
  heading: string;
  rows: [label: string, value: string | undefined][];
}

/**
 * Shows Book information or Where am I in the information dialog: each part a heading with a
 * two-column table (label, value), so a screen reader can move by heading and read the table
 * row by row, and every value can be selected and copied.
 */
export function showInfo(dialog: HTMLDialogElement, title: string, sections: InfoSection[]): void {
  const heading = dialog.querySelector<HTMLElement>('h2')!;
  heading.textContent = title;
  const body = dialog.querySelector<HTMLElement>('.ui-info-body')!;
  body.replaceChildren();
  for (const section of sections) {
    const rows = section.rows.filter((r): r is [string, string] => !!r[1]?.trim());
    if (!rows.length) continue;
    const h = document.createElement('h3');
    h.textContent = section.heading;
    const table = document.createElement('table');
    table.className = 'ui-info-table';
    // The heading names the table, so table navigation says which part it is in.
    h.id = `ui-info-h${body.childElementCount}`;
    table.setAttribute('aria-labelledby', h.id);
    const tbody = table.createTBody();
    for (const [label, value] of rows) {
      const tr = tbody.insertRow();
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = label;
      const td = tr.insertCell();
      td.textContent = value;
      tr.prepend(th);
    }
    body.append(h, table);
  }
  openDialog(dialog, () => heading);
}

const FORMATS: Record<BookInfo['format'], string> = { epub: 'EPUB', daisy202: 'DAISY 2.02', daisy3: 'DAISY 3', ebraille: 'eBraille (braille, already formatted)' };

/** What a DAISY multimedia type means, in words. */
const MULTIMEDIA: Record<string, string> = {
  audiofulltext: 'audio and full text',
  audioparttext: 'audio and part of the text',
  audioonly: 'audio only',
  audioncc: 'audio, with headings only',
  audionctext: 'audio with headings, and text',
  textpartaudio: 'text, with audio for part of it',
  textncc: 'text, with headings only',
  textonly: 'text only',
  textnctext: 'text only',
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Book information: what the book says about itself, what it holds, then every metadata entry. */
export function bookInfoSections(book: BookInfo, spokenDuration: (seconds: number) => string): InfoSection[] {
  const m = book.metadata;
  const type = m.multimediaType ? MULTIMEDIA[m.multimediaType.toLowerCase()] ?? m.multimediaType : undefined;
  const contents = countToc(book.toc);
  const pages = book.pageList;
  const many = (name: string) => (m.entries ?? []).filter((e) => e.name.toLowerCase() === name).map((e) => e.value);
  return [
    {
      heading: 'About this book',
      rows: [
        ['Title', m.title],
        [m.authors.length > 1 ? 'Authors' : 'Author', m.authors.join(', ')],
        [m.narrators.length > 1 ? 'Narrators' : 'Narrator', m.narrators.join(', ')],
        ['Publisher', m.publisher],
        ['Date', many('dc:date')[0]],
        ['Language', m.language],
        ['Subject', many('dc:subject').join('; ')],
        ['Description', many('dc:description').join(' ')],
        ['Rights', many('dc:rights').join(' ')],
        ['Identifier', m.identifier],
      ],
    },
    {
      heading: 'What the book holds',
      rows: [
        ['Format', [FORMATS[book.format], type].filter(Boolean).join(', ')],
        ['Recorded narration', book.narration.length ? `Yes${m.duration ? `, ${spokenDuration(m.duration)}` : ''}` : 'No'],
        ['Text', book.readingOrder.length ? plural(book.readingOrder.length, 'section') : 'None (audio only)'],
        ['Contents', contents ? (contents === 1 ? '1 entry' : `${contents} entries`) : 'None'],
        ['Printed pages', pages.length ? `${pages.length}, from ${pages[0]!.label} to ${pages.at(-1)!.label}` : 'Not marked'],
      ],
    },
    {
      heading: 'Accessibility, as the book declares it',
      rows: (m.entries ?? [])
        .filter((e) => /^(schema:)?access|^a11y:|conformsto|dcterms:conformsto/i.test(e.name))
        .map((e) => [e.name, e.value] as [string, string]),
    },
    {
      heading: 'All metadata in the book',
      rows: (m.entries ?? []).map((e) => [e.name, e.value] as [string, string]),
    },
  ];
}

function countToc(items: BookInfo['toc']): number {
  return items.reduce((n, item) => n + 1 + countToc(item.children ?? []), 0);
}
