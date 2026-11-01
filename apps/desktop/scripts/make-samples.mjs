// Builds sample books for trying the reader before real Sugamya books are available:
//   samples/sample-daisy202.zip  DAISY 2.02 full text + full audio, narrated by the Windows voice
//   samples/sample-text.epub     EPUB 3 with text only (for the device-voice read-aloud)
// Run: npm run samples   (Windows; falls back to silent audio if speech synthesis fails)

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

const outDir = path.resolve('samples');
mkdirSync(outDir, { recursive: true });

const chapters = [
  {
    heading: 'Chapter 1. The Library',
    level: 1,
    page: '1',
    phrases: [
      'Sugamya Pustakalaya is an online library for people with print disabilities.',
      'It offers books in DAISY, EPUB and braille formats.',
    ],
  },
  {
    heading: 'Chapter 2. Reading Modes',
    level: 1,
    page: '2',
    phrases: [
      'You can read with text only, audio only, or text and audio together.',
      'In text and audio mode, the sentence being read is highlighted.',
    ],
  },
  {
    heading: 'Shortcuts',
    level: 2,
    phrases: ['Press Control Space to play or pause.', 'Press Alt Down Arrow to move to the next heading.'],
  },
];

// ---- audio ----

const items = [];
chapters.forEach((ch, c) => {
  items.push({ id: `c${c}h`, text: ch.heading });
  ch.phrases.forEach((text, p) => items.push({ id: `c${c}p${p}`, text }));
});

const work = path.join(tmpdir(), `reader-samples-${process.pid}`);
mkdirSync(work, { recursive: true });
for (const item of items) item.file = path.join(work, `${item.id}.wav`);

function synthesize() {
  const script = path.join(work, 'speak.ps1');
  const list = path.join(work, 'items.json');
  writeFileSync(list, JSON.stringify(items.map(({ text, file }) => ({ text, file }))));
  writeFileSync(
    script,
    `Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -LiteralPath $args[0] | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = 1
foreach ($i in $items) { $s.SetOutputToWaveFile($i.file); $s.Speak($i.text) }
$s.SetOutputToNull(); $s.Dispose()
`,
  );
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, list], { stdio: 'inherit' });
}

function silentWav(seconds) {
  const rate = 16000;
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

function wavDuration(buf) {
  let byteRate = 0;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(at + 16);
    if (id === 'data') return Math.min(size, buf.length - at - 8) / byteRate;
    at += 8 + size + (size % 2);
  }
  throw new Error('Not a WAV file');
}

let spoken = true;
try {
  synthesize();
} catch (err) {
  console.warn('Speech synthesis failed, using silent audio:', err.message);
  spoken = false;
}
for (const item of items) {
  item.audio = spoken ? readFileSync(item.file) : silentWav(0.35 * item.text.split(' ').length);
  item.duration = wavDuration(item.audio);
}
rmSync(work, { recursive: true, force: true });

// ---- DAISY 2.02 ----

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const clock = (s) => `npt=${s.toFixed(3)}s`;
const hms = (s) => new Date(Math.round(s) * 1000).toISOString().slice(11, 19);
const total = items.reduce((t, i) => t + i.duration, 0);
const byId = Object.fromEntries(items.map((i) => [i.id, i]));

const daisy = {};
const nccBody = [];
const content = [];
chapters.forEach((ch, c) => {
  const smil = `s${c + 1}.smil`;
  const pars = [];
  const par = (id, textId) =>
    `  <par endsync="last" id="${id}"><text src="content.html#${textId}"/><seq><audio src="${id}.wav" clip-begin="${clock(0)}" clip-end="${clock(byId[id].duration)}"/></seq></par>`;
  nccBody.push(`<h${ch.level} id="n${c}"><a href="${smil}#c${c}h">${esc(ch.heading)}</a></h${ch.level}>`);
  content.push(`<h${ch.level} id="t_c${c}h">${esc(ch.heading)}</h${ch.level}>`);
  pars.push(par(`c${c}h`, `t_c${c}h`));
  if (ch.page) {
    nccBody.push(`<span class="page-normal" id="np${c}"><a href="${smil}#c${c}p0">${ch.page}</a></span>`);
    content.push(`<span class="page-normal" id="pg${ch.page}">${ch.page}</span>`);
  }
  ch.phrases.forEach((text, p) => {
    content.push(`<p id="t_c${c}p${p}">${esc(text)}</p>`);
    pars.push(par(`c${c}p${p}`, `t_c${c}p${p}`));
  });
  daisy[smil] = `<?xml version="1.0" encoding="utf-8"?>
<smil><head><meta name="dc:format" content="Daisy 2.02"/></head><body><seq>
${pars.join('\n')}
</seq></body></smil>`;
});
for (const item of items) daisy[`${item.id}.wav`] = item.audio;

daisy['ncc.html'] = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Sample Book</title>
<meta name="dc:title" content="Sample Book for the Reader"/>
<meta name="dc:creator" content="Accessible Reader team"/>
<meta name="dc:language" content="en"/>
<meta name="dc:identifier" content="sample-daisy202-0001"/>
<meta name="ncc:narrator" content="${spoken ? 'Windows voice' : 'Silence'}"/>
<meta name="ncc:multimediaType" content="audioFullText"/>
<meta name="ncc:totalTime" content="${hms(total)}"/>
</head><body>
${nccBody.join('\n')}
</body></html>`;
daisy['content.html'] = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>Sample Book</title></head><body>
${content.join('\n')}
</body></html>`;

writeFileSync(path.join(outDir, 'sample-daisy202.zip'), zipSync(toBytes(daisy)));

// ---- EPUB 3, text only ----

const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>Sample</title></head><body>
${chapters
  .map(
    (ch, c) =>
      `<h${ch.level} id="h${c}">${esc(ch.heading)}</h${ch.level}>` +
      (ch.page ? `<span epub:type="pagebreak" role="doc-pagebreak" id="page${ch.page}" aria-label="Page ${ch.page}"/>` : '') +
      ch.phrases.map((t) => `<p>${esc(t)}</p>`).join(''),
  )
  .join('\n')}
</body></html>`;
const epub = {
  mimetype: 'application/epub+zip',
  'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  'EPUB/package.opf': `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">sample-epub-0001</dc:identifier><dc:title>Sample Text-only EPUB</dc:title><dc:language>en</dc:language></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c" href="content.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c"/></spine></package>`,
  'EPUB/nav.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol>${chapters.map((ch, c) => `<li><a href="content.xhtml#h${c}">${esc(ch.heading)}</a></li>`).join('')}</ol></nav>
<nav epub:type="page-list"><ol>${chapters.filter((ch) => ch.page).map((ch) => `<li><a href="content.xhtml#page${ch.page}">${ch.page}</a></li>`).join('')}</ol></nav>
</body></html>`,
  'EPUB/content.xhtml': xhtml,
};
writeFileSync(path.join(outDir, 'sample-text.epub'), zipSync(toBytes(epub)));

console.log(`Samples written to ${outDir} (${spoken ? 'spoken' : 'silent'} audio, ${total.toFixed(1)} s)`);

function toBytes(files) {
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : new Uint8Array(v)]));
}
