import { describe, expect, it } from 'vitest';
import { dtbookToHtml } from '../src/index.js';
import { xmldomPlatform } from '../src/platform/xmldom.js';

describe('dtbookToHtml', () => {
  it('converts structure, keeps ids and marks page breaks', () => {
    const dtbook = xmldomPlatform.parseXml(`<?xml version="1.0"?>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xml:lang="hi">
  <head><meta name="dc:Title" content="x"/></head>
  <book><bodymatter>
    <level><hd id="a">Part</hd>
      <level><hd id="b">Chapter</hd>
        <pagenum id="pg5" page="normal">5</pagenum>
        <p id="c"><sent id="s1">One &amp; two.</sent> <noteref idref="#n1">1</noteref></p>
        <list type="ol"><li>First</li></list>
        <imggroup><img src="pic.png" alt="A picture"/><caption>Figure 1</caption></imggroup>
        <note id="n1"><p>The note.</p></note>
      </level>
    </level>
  </bodymatter></book>
</dtbook>`);

    const html = dtbookToHtml(dtbook);
    expect(html).not.toContain('dc:Title');
    expect(html).toContain('<h1 id="a" class="dtb-hd">Part</h1>');
    expect(html).toContain('<h2 id="b" class="dtb-hd">Chapter</h2>');
    expect(html).toContain('<span id="pg5" class="dtb-pagenum" role="doc-pagebreak" aria-label="Page 5">5</span>');
    expect(html).toContain('<span id="s1" class="dtb-sent">One &amp; two.</span>');
    expect(html).toContain('<a class="dtb-noteref" href="#n1">1</a>');
    expect(html).toContain('<ol class="dtb-list"><li class="dtb-li">First</li></ol>');
    expect(html).toContain('<img src="pic.png" alt="A picture" class="dtb-img">');
    expect(html).toContain('<figcaption class="dtb-caption">Figure 1</figcaption>');
    expect(html).toContain('<aside id="n1" class="dtb-note">');
  });
  it('keeps maths (m:math) as MathML, without the prefix', () => {
    const dtbook = xmldomPlatform.parseXml(`<?xml version="1.0"?>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML">
  <book><bodymatter><level><p>Half is <m:math alttext="one half" display="inline"><m:mfrac><m:mn>1</m:mn><m:mn>2</m:mn></m:mfrac></m:math>.</p></level></bodymatter></book>
</dtbook>`);
    expect(dtbookToHtml(dtbook)).toContain(
      '<p class="dtb-p">Half is <math xmlns="http://www.w3.org/1998/Math/MathML" alttext="one half" display="inline"><mfrac><mn>1</mn><mn>2</mn></mfrac></math>.</p>',
    );
  });
});
