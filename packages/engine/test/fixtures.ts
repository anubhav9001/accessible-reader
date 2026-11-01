import { strToU8, zipSync } from 'fflate';

/** Tiny but structurally real books, one per format, built in memory for the tests. */

const fakeAudio = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

export function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])),
  );
}

export function epub3({ withOverlay = true } = {}): Record<string, string | Uint8Array> {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OEBPS/package.opf': `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:isbn:9780000000001</dc:identifier>
    <dc:title>Sample EPUB</dc:title>
    <dc:creator>A. Writer</dc:creator>
    <dc:language>hi</dc:language>
    <meta property="media:duration">0:00:05.000</meta>
    <meta property="media:duration" refines="#ch1_mo">0:00:05.000</meta>
    <meta property="media:narrator">R. Voice</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"${withOverlay ? ' media-overlay="ch1_mo"' : ''}/>
    <item id="ch1_mo" href="smil/ch1.smil" media-type="application/smil+xml"/>
    <item id="a1" href="audio/ch1.mp3" media-type="audio/mpeg"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
    'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc"><ol>
    <li><a href="text/ch1.xhtml#h1">Chapter 1</a>
      <ol><li><a href="text/ch1.xhtml#s2">Section 1.1</a></li></ol>
    </li>
  </ol></nav>
  <nav epub:type="page-list"><ol><li><a href="text/ch1.xhtml#p1">1</a></li></ol></nav>
</body>
</html>`,
    'OEBPS/text/ch1.xhtml': `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <h1 id="h1">Chapter 1</h1><h2 id="s2">Section 1.1</h2><p><span id="p1">Page one text.</span></p>
</body></html>`,
    'OEBPS/smil/ch1.smil': `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
  <body><seq epub:textref="../text/ch1.xhtml">
    <par id="m1"><text src="../text/ch1.xhtml#h1"/><audio src="../audio/ch1.mp3" clipBegin="0s" clipEnd="2s"/></par>
    <par id="m2"><text src="../text/ch1.xhtml#s2"/><audio src="../audio/ch1.mp3" clipBegin="2s" clipEnd="3500ms"/></par>
    <par id="m3"><text src="../text/ch1.xhtml#p1"/><audio src="../audio/ch1.mp3" clipBegin="0:00:03.500" clipEnd="00:05"/></par>
  </seq></body>
</smil>`,
    'OEBPS/audio/ch1.mp3': fakeAudio,
  };
}

export function daisy3(): Record<string, string | Uint8Array> {
  return {
    'book/book.opf': `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://openebook.org/namespaces/oeb-package/1.0/" unique-identifier="uid">
  <metadata>
    <dc-metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:Title>Sample DAISY 3</dc:Title>
      <dc:Creator>B. Author</dc:Creator>
      <dc:Language>en-IN</dc:Language>
      <dc:Identifier id="uid">DFI-0001</dc:Identifier>
    </dc-metadata>
    <x-metadata>
      <meta name="dtb:multimediaType" content="audioFullText"/>
      <meta name="dtb:totalTime" content="0:00:06.000"/>
      <meta name="dtb:narrator" content="C. Reader"/>
    </x-metadata>
  </metadata>
  <manifest>
    <item id="opf" href="book.opf" media-type="text/xml"/>
    <item id="ncx" href="navigation.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="xml" href="dtbook.xml" media-type="application/x-dtbook+xml"/>
    <item id="smil1" href="01.smil" media-type="application/smil"/>
    <item id="aud" href="01.mp3" media-type="audio/mpeg"/>
  </manifest>
  <spine><itemref idref="smil1"/></spine>
</package>`,
    'book/navigation.ncx': `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <docTitle><text>Sample DAISY 3</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>Part One</text></navLabel><content src="01.smil#s1"/>
      <navPoint id="n2" playOrder="2"><navLabel><text>Chapter A</text></navLabel><content src="01.smil#p2"/></navPoint>
    </navPoint>
  </navMap>
  <pageList><pageTarget id="pg1" type="normal" value="1" playOrder="3"><navLabel><text>1</text></navLabel><content src="01.smil#p2"/></pageTarget></pageList>
</ncx>`,
    'book/dtbook.xml': `<?xml version="1.0" encoding="utf-8"?>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><book><bodymatter>
  <level1><h1 id="d1">Part One</h1><level2><h2 id="d2">Chapter A</h2></level2></level1>
</bodymatter></book></dtbook>`,
    'book/01.smil': `<?xml version="1.0" encoding="utf-8"?>
<smil xmlns="http://www.w3.org/2001/SMIL20/"><body>
  <seq id="s1">
    <par id="p1"><text src="dtbook.xml#d1"/><audio src="01.mp3" clipBegin="0:00:00.000" clipEnd="0:00:02.500"/></par>
    <par id="p2"><text src="dtbook.xml#d2"/>
      <seq><audio src="01.mp3" clipBegin="0:00:02.500" clipEnd="0:00:04.000"/><audio src="01.mp3" clipBegin="0:00:04.000" clipEnd="0:00:06.000"/></seq>
    </par>
  </seq>
</body></smil>`,
    'book/01.mp3': fakeAudio,
  };
}

/** DAISY 2.02 audio-only book (text points back at the NCC), stored with an upper-case NCC.HTML. */
export function daisy202AudioOnly(): Record<string, string | Uint8Array> {
  return {
    // strToU8(…, true) stores one byte per character, i.e. real windows-1252 bytes for "é".
    'NCC.HTML': strToU8(`<?xml version="1.0" encoding="windows-1252"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head>
  <title>Fallback Title</title>
  <meta name="dc:title" content="Sample DAISY 2.02 Café"/>
  <meta name="dc:creator" content="D. Poet"/>
  <meta name="ncc:narrator" content="E. Speaker"/>
  <meta name="ncc:multimediaType" content="audioNcc"/>
  <meta name="ncc:totalTime" content="00:00:07"/>
</head><body>
  <h1 id="i1"><a href="a.smil#t1">Introduction</a></h1>
  <h2 id="i2"><a href="b.smil#t2">Chapter&nbsp;1</a></h2>
  <span class="page-normal" id="i3"><a href="b.smil#t3">1</a></span>
</body></html>`, true),
    'a.smil': `<?xml version="1.0" encoding="windows-1252"?>
<smil><body><seq dur="3.0s">
  <par endsync="last" id="t1"><text src="ncc.html#i1" id="tx1"/>
    <seq><audio src="a.mp3" clip-begin="npt=0.000s" clip-end="npt=3.000s" id="au1"/></seq></par>
</seq></body></smil>`,
    'b.smil': `<?xml version="1.0" encoding="windows-1252"?>
<smil><body><seq dur="4.0s">
  <par endsync="last" id="t2"><text src="ncc.html#i2"/><seq><audio src="b.mp3" clip-begin="npt=0.000s" clip-end="npt=1.500s"/></seq></par>
  <par endsync="last" id="t3"><text src="ncc.html#i3"/><seq><audio src="b.mp3" clip-begin="npt=1.500s" clip-end="npt=4.000s"/></seq></par>
</seq></body></smil>`,
    'a.mp3': fakeAudio,
    'b.mp3': fakeAudio,
  };
}

/** DAISY 2.02 full-text, full-audio book with a separate content file. */
export function daisy202FullText(): Record<string, string | Uint8Array> {
  return {
    'ncc.html': `<html><head>
  <meta name="dc:title" content="Full Text 2.02">
  <meta name="ncc:multimediaType" content="audioFullText">
</head><body>
  <h1><a href="c.smil#q1">Only Chapter</a></h1>
</body></html>`,
    'c.smil': `<smil><body><seq>
  <par id="q1"><text src="content.html#c1"/><audio src="c.mp3" clip-begin="npt=0s" clip-end="npt=2s"/></par>
  <par id="q2"><text src="content.html#c2"/><audio src="c.mp3" clip-begin="npt=2s" clip-end="npt=3s"/></par>
</seq></body></smil>`,
    'content.html': `<html><body><h1 id="c1">Only Chapter</h1><p id="c2">Hello.</p></body></html>`,
    'c.mp3': fakeAudio,
  };
}
