// ==UserScript==
// @name         Novel Lucky - Chapter Text Extractor + Ad Blocker
// @namespace    local.novel-lucky.extractor
// @version      1.2
// @description  คัดลอก/ดาวน์โหลดตอน และดึงทุกตอนจาก novel-lucky.com เป็น .txt หรือ .epub ถอดรหัสฟอนต์สลับตัวอักษร (LuckyNovelGlyphShield) อัตโนมัติ พร้อมบล็อกแบนเนอร์โฆษณาทุกจุด
// @match        https://novel-lucky.com/*
// @noframes
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const DELAY_MS = 1000; // หน่วงเวลาระหว่างตอน กันโดนบล็อก

  // ============================================================
  // 1) บล็อกโฆษณา — ทำงานทุกหน้าของเว็บ ตั้งแต่ก่อนหน้าโหลดเสร็จ
  //    (ตรวจจาก HTML จริงของเว็บ: แบนเนอร์ลอย widget_02-04, แถว .n-ban,
  //     วิดเจ็ต custom-html-widget และลิงก์/รูปจากโดเมนโฆษณา)
  // ============================================================
  const AD_BOX = '#widget_02, #widget_03, #widget_04, .n-ban';
  const AD_HREF = 'a[href*="cutt.ly"], a[href*="mytopaff.com"], a[href*="we356s2.com"], a[href*="me356s.live"], a[href*="giannasgrille.com"]';
  const AD_IMG = 'img[src*="greatestglasses.com"], img[src*="brenzo9.com"]';

  const AD_CSS = `
    ${AD_BOX}, ${AD_HREF}, ${AD_IMG} { display: none !important; height: 0 !important; }
    /* กันที่วิดเจ็ตแบนเนอร์ยังเหลือช่องว่าง */
    .custom-html-widget:has(${AD_HREF}) { display: none !important; }
  `;

  let cssInjected = false;
  function injectAdCss() {
    if (cssInjected || !document.head) return;
    const st = document.createElement('style');
    st.id = 'nlx-adblock-css';
    st.textContent = AD_CSS;
    document.head.appendChild(st);
    cssInjected = true;
  }

  // ลบก้อนโฆษณาออกจาก DOM จริง (แค่ display:none ยังทิ้งช่องว่างและยังคลิกโดน)
  function sweepAds() {
    let removed = 0;
    document.querySelectorAll(AD_BOX).forEach(el => { el.remove(); removed++; });
    document.querySelectorAll(AD_HREF + ', ' + AD_IMG).forEach(el => {
      const anchor = el.closest('a') || el;
      const widget = anchor.closest('.custom-html-widget, .textwidget');
      anchor.remove();
      // วิดเจ็ตที่เหลือแต่ความว่างเปล่าหลังลบแบนเนอร์ ลบทิ้งด้วย
      if (widget && !widget.querySelector('a') && !widget.textContent.trim()) widget.remove();
      removed++;
    });
    return removed;
  }

  let sweepQueued = false;
  function queueSweep() {
    if (sweepQueued) return;
    sweepQueued = true;
    setTimeout(() => { sweepQueued = false; sweepAds(); }, 100);
  }

  function startAdBlock() {
    injectAdCss();
    // กันพลาดกรณี head ยังไม่พร้อมตอน document-start
    if (!cssInjected) {
      document.addEventListener('readystatechange', injectAdCss, { once: true });
      document.addEventListener('DOMContentLoaded', injectAdCss, { once: true });
    }
    sweepAds();
    // โฆษณาที่ถูกแทรกทีหลัง (เช่น เลื่อนอ่านไปเรื่อยๆ) — เฝ้า DOM แล้วกวาดซ้ำ
    new MutationObserver(queueSweep).observe(document.documentElement, { childList: true, subtree: true });
    // ดักคลิกลิงก์โฆษณาที่หลุดรอด (กันเปิดหน้าโฆษณาโดยบังเอิญ)
    const kill = e => {
      const a = e.target && e.target.closest && e.target.closest(AD_HREF);
      if (a) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('click', kill, true);
    document.addEventListener('auxclick', kill, true);
  }

  // ปิด window.open ไปนอกโดเมน (กัน popunder ที่อาจถูกเติมทีหลัง)
  function guardWindowOpen() {
    try {
      const s = document.createElement('script');
      s.textContent = '(' + function () {
        const orig = window.open;
        window.open = function (u, n, f) {
          try { if (!u || new URL(u, location.href).origin === location.origin) return orig.call(window, u, n, f); } catch (e) { return null; }
          return null;
        };
      } + ')();';
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) { /* ไม่จำเป็นต้องมีก็ยังใช้งานได้ */ }
  }

  startAdBlock();
  guardWindowOpen();

  // ============================================================
  // 2) ตัวดึงข้อความ (แผงปุ่มแสดงเฉพาะหน้าอ่านตอน)
  // ============================================================
  const ready = new Promise(res => {
    if (document.readyState !== 'loading') res();
    else document.addEventListener('DOMContentLoaded', () => res(), { once: true });
  });

  // ============================================================
  // 3) ตัวถอดฟอนต์สลับรหัส (LuckyNovelGlyphShield)
  //    เว็บแทนพยัญชนะไทย (บางฟอนต์รวมถึงอังกฤษ/ตัวเลข) ด้วยรหัสอื่น
  //    แล้วใช้ฟอนต์เฉพาะต่อเรื่องวาดให้กลับเป็นตัวที่ถูก — copy ตรงๆ เลยเพี้ยน
  //    วิธีถอด: เทียบรูปทรงที่ฟอนต์นี้วาดแต่ละรหัส กับรูปทรงจริงของฟอนต์ Sarabun
  //    (ฟอนต์ต้นฉบับที่เว็บใช้) ด้วยการเรนเดอร์บน canvas
  // ============================================================
  const GS_URL_RE = /https?:\/\/[^'"\s)]*lucky-plugin-1\/assets\/fonts\/[^'"\s)]+\.woff2/g;
  const fontUrlsFromText = t => (t && t.match(GS_URL_RE)) || [];

  function findFontUrls(doc, rawHtml) {
    const urls = new Set();
    fontUrlsFromText(rawHtml).forEach(u => urls.add(u));
    try {
      fontUrlsFromText(doc.documentElement.innerHTML).forEach(u => urls.add(u));
    } catch (e) { /* DOMParser doc บางชนิดอ่านไม่ได้ ข้ามไป */ }
    if (doc === document) {
      for (const e of performance.getEntriesByType('resource'))
        if (/lucky-plugin-1\/assets\/fonts\/[^?]+\.woff2/.test(e.name)) urls.add(e.name);
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const r of rules)
          if (r instanceof CSSFontFaceRule) fontUrlsFromText(r.cssText).forEach(u => urls.add(u));
      }
    }
    return [...urls];
  }

  const fontCache = new Map(); // fontUrl -> Map(รหัสที่สลับ -> ตัวจริง) หรือ Promise ที่ให้ Map
  const CHARSET = (() => {
    let s = '';
    for (let c = 0x0e00; c <= 0x0e7f; c++) s += String.fromCharCode(c); // ไทยทั้งบล็อก
    for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c);     // ASCII พิมพ์ได้
    return s;
  })();

  function renderBits(char, family) {
    const cv = document.createElement('canvas');
    cv.width = 48; cv.height = 56;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.font = '48px "' + family + '"';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    ctx.fillText(char, 12, 44);
    const img = ctx.getImageData(0, 0, 48, 56).data;
    const bits = new Uint8Array(24 * 28);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 24; x++) {
      let sum = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
        sum += img[((y * 2 + dy) * 48 + x * 2 + dx) * 4 + 3];
      bits[y * 24 + x] = sum / 4 > 64 ? 1 : 0;
    }
    return bits;
  }

  function shapeDist(a, b) {
    let diff = 0, uni = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diff++;
      if (a[i] || b[i]) uni++;
    }
    return uni ? diff / uni : 1;
  }

  async function loadFontInto(family, url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('โหลดฟอนต์ไม่สำเร็จ HTTP ' + res.status);
    const ff = new FontFace(family, await res.arrayBuffer());
    await ff.load();
    document.fonts.add(ff);
  }

  async function getReferenceFontUrl() {
    const res = await fetch('https://fonts.googleapis.com/css?family=Sarabun:regular&subset=thai');
    const css = await res.text();
    for (const block of css.split('@font-face')) {
      if (/0e01/i.test(block) || /\/\*\s*thai/i.test(block)) {
        const m = /url\((https:\/\/[^)]+\.woff2)\)/.exec(block);
        if (m) return m[1];
      }
    }
    const any = /url\((https:\/\/[^)]+\.woff2)\)/.exec(css);
    return any ? any[1] : null;
  }

  async function buildSwapMap(url, idx) {
    const gsFamily = 'NLXGS' + idx;
    await loadFontInto(gsFamily, url);
    const refUrl = await getReferenceFontUrl();
    if (!refUrl) throw new Error('ไม่พบฟอนต์อ้างอิง Sarabun');
    await loadFontInto('NLXREF', refUrl);

    const glyphs = [], refs = [];
    for (const ch of CHARSET) {
      const bits = renderBits(ch, gsFamily);
      if (bits.some(b => b)) glyphs.push({ ch, bits });
    }
    for (const ch of CHARSET) {
      const bits = renderBits(ch, 'NLXREF');
      if (bits.some(b => b)) refs.push({ ch, bits });
    }

    const map = new Map();
    for (const g of glyphs) {
      let best = null, bestD = 1, second = 1;
      for (const r of refs) {
        const d = shapeDist(g.bits, r.bits);
        if (d < bestD) { second = bestD; bestD = d; best = r.ch; }
        else if (d < second) second = d;
      }
      // ยอมรับเฉพาะคู่ที่รูปทรงตรงชัดเจนและต่างจากรองชัดพอ กันแมปผิด
      if (best && best !== g.ch && bestD < 0.12 && second - bestD > 0.04) map.set(g.ch, best);
    }
    return map;
  }

  async function getSwapMap(doc, rawHtml) {
    let urls = findFontUrls(doc, rawHtml);
    let lastErr = null;
    if (!urls.length && doc === document) {
      // กันกรณีหน้าถูกโหลด/แก้ด้วย AJAX จนหาฟอนต์ไม่เจอ -> ดึง source ดิบมาหาใหม่
      try {
        const res = await fetch(location.href, { credentials: 'same-origin' });
        if (res.ok) urls = fontUrlsFromText(await res.text());
      } catch (e) { lastErr = e; }
    }
    if (!urls.length) throw new Error('ไม่พบฟอนต์ถอดรหัสในหน้านี้' + (lastErr ? ' (' + lastErr.message + ')' : ''));
    const merged = new Map();
    const errs = [];
    urls.forEach((u, i) => {
      if (!fontCache.has(u)) {
        fontCache.set(u, buildSwapMap(u, i).catch(e => { errs.push(u.split('/').pop() + ': ' + e.message); return new Map(); }));
      }
    });
    for (const u of urls) {
      const m = await fontCache.get(u);
      if (m) for (const [k, v] of m) merged.set(k, v);
    }
    if (!merged.size && errs.length) throw new Error('อ่านฟอนต์ไม่สำเร็จ — ' + errs.join(' | '));
    return merged;
  }

  async function extract(doc, rawHtml) {
    const box = doc.querySelector('.reading-content .text-left') || doc.querySelector('.reading-content');
    if (!box) return null;
    // ลบตัวอักษรแฝง (ZWSP ฯลฯ) กัน Notepad++ โชว์กล่อง
    const clean = s => (s || '').replace(/\u00a0/g, ' ').replace(/[\u200b\u2060\ufeff]/g, '').trim();

    let map = new Map(), noFont = false, fontErr = null;
    try { map = await getSwapMap(doc, rawHtml); }
    catch (e) { noFont = true; fontErr = e.message; }
    const decode = s => (map.size ? (s || '').replace(/[\s\S]/g, ch => map.get(ch) ?? ch) : (s || ''));

    // หัวเรื่อง/ชื่อตอนไม่ได้ถูกเข้ารหัส (ฟอนต์รหัสสลับถูกบังคับเฉพาะ .text-left)
    // จึงห้ามผ่านตารางถอด ไม่งั้นข้อความที่ถูกอยู่แล้วจะกลายเป็นเพี้ยน
    const title = clean(doc.querySelector('#chapter-heading')?.textContent || doc.title);
    const paras = [...box.querySelectorAll('p')].map(p => clean(decode(p.textContent))).filter(Boolean);
    const body = paras.length ? paras.join('\n\n') : clean(decode(box.innerText));
    const next = doc.querySelector('a.next_page')?.href || null;
    const unknownCodes = [...new Set((body.match(/[\ue000-\uf8ff]/g) || []).map(c => c.codePointAt(0).toString(16)))].sort();
    return { title, body, next, unknown: unknownCodes.length, unknownCodes, noFont, fontErr };
  }

  const safeName = s => s.replace(/[\/:*?"<>|]/g, '_').slice(0, 120);

  function download(filename, text) {
    const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- EPUB builder (zip แบบ store ไม่บีบอัด ไม่ต้องพึ่งไลบรารี) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = u8 => {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  function zipStore(files) { // files: [{name, data: string}] ; ไฟล์แรกต้องเป็น mimetype
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, a) => s + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/epub+zip' });
  }

  const xmlEsc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function buildEpub(bookTitle, chapters) { // chapters: [{title, body}]
    const files = [
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'META-INF/container.xml', data: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
      { name: 'OEBPS/style.css', data: 'body{line-height:1.7}h2{text-align:center;margin:1em 0}p{margin:0 0 .8em;text-indent:1.5em}' },
    ];
    const manifest = [], spine = [], navLi = [], ncxPts = [];
    chapters.forEach((c, i) => {
      const id = 'ch' + (i + 1);
      const paras = c.body.split(/\n{2,}/).map(p => `<p>${xmlEsc(p).replace(/\n/g, '<br/>')}</p>`).join('\n');
      files.push({
        name: `OEBPS/${id}.xhtml`,
        data: `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="th"><head><meta charset="utf-8"/><title>${xmlEsc(c.title)}</title><link rel="stylesheet" href="style.css"/></head><body><h2>${xmlEsc(c.title)}</h2>\n${paras}</body></html>`,
      });
      manifest.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
      spine.push(`<itemref idref="${id}"/>`);
      navLi.push(`<li><a href="${id}.xhtml">${xmlEsc(c.title)}</a></li>`);
      ncxPts.push(`<navPoint id="${id}" playOrder="${i + 1}"><navLabel><text>${xmlEsc(c.title)}</text></navLabel><content src="${id}.xhtml"/></navPoint>`);
    });
    const uid = 'urn:uuid:' + crypto.randomUUID();
    files.push(
      { name: 'OEBPS/nav.xhtml', data: `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="th"><head><meta charset="utf-8"/><title>สารบัญ</title></head><body><nav epub:type="toc"><h1>สารบัญ</h1><ol>${navLi.join('')}</ol></nav></body></html>` },
      { name: 'OEBPS/toc.ncx', data: `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3985/2005/ncx" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/></head><docTitle><text>${xmlEsc(bookTitle)}</text></docTitle><navMap>${ncxPts.join('')}</navMap></ncx>` },
      { name: 'OEBPS/content.opf', data: `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${uid}</dc:identifier><dc:title>${xmlEsc(bookTitle)}</dc:title><dc:language>th</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${manifest.join('')}</manifest><spine toc="ncx">${spine.join('')}</spine></package>` },
    );
    return zipStore(files);
  }

  function downloadBlob(filename, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- UI ----------
  ready.then(() => {
    if (!document.querySelector('.reading-content')) return; // ไม่ใช่หน้าอ่านตอน — ไม่ต้องมีแผงปุ่ม

    GM_addStyle(`
      #nlx-panel{position:fixed;right:12px;bottom:12px;z-index:99999;display:flex;flex-direction:column;gap:6px;font:13px sans-serif}
      #nlx-panel button{padding:7px 10px;border:0;border-radius:6px;background:#059669;color:#fff;cursor:pointer;opacity:.9}
      #nlx-panel button:hover{opacity:1}
      #nlx-panel button:disabled{background:#888;cursor:default}
      #nlx-status{background:rgba(0,0,0,.75);color:#fff;padding:4px 8px;border-radius:6px;max-width:220px;display:none}
    `);

    const panel = document.createElement('div');
    panel.id = 'nlx-panel';
    panel.innerHTML = `
      <div id="nlx-status"></div>
      <button id="nlx-copy">คัดลอกตอนนี้</button>
      <button id="nlx-save">ดาวน์โหลดตอนนี้ (.txt)</button>
      <button id="nlx-all">ดึงทุกตอนต่อจากนี้ (.txt/.epub)</button>
      <button id="nlx-stop" style="display:none;background:#dc2626">หยุด</button>`;
    document.body.appendChild(panel);

    const $ = id => panel.querySelector('#' + id);
    const status = msg => {
      const el = $('nlx-status');
      el.style.display = msg ? 'block' : 'none';
      el.textContent = msg || '';
    };

    async function current() {
      try {
        const c = await extract(document);
        if (!c) { status('ไม่พบเนื้อหาตอนนี้'); return null; }
        if (c.unknown) status(`เตือน: ถอดรหัสไม่ได้ ${c.unknown} ตัว (U+${c.unknownCodes.join(', U+')})`);
        else if (c.noFont) status('เตือน: ถอดรหัสไม่ได้ — ' + (c.fontErr || 'ไม่พบฟอนต์'));
        return c;
      } catch (e) {
        status('ผิดพลาด: ' + e.message);
        return null;
      }
    }

    $('nlx-copy').onclick = async () => {
      const c = await current();
      if (!c) return;
      GM_setClipboard(`${c.title}\n\n${c.body}`);
      if (!c.unknown && !c.noFont) { status('คัดลอกแล้ว'); setTimeout(() => status(''), 2000); }
    };

    $('nlx-save').onclick = async () => {
      const c = await current();
      if (!c) return;
      download(safeName(c.title) + '.txt', `${c.title}\n\n${c.body}\n`);
    };

    let stop = false;
    $('nlx-stop').onclick = () => { stop = true; };

    $('nlx-all').onclick = async () => {
      const input = prompt('จะดึงกี่ตอน (นับจากตอนนี้)? เว้นว่าง = จนถึงตอนสุดท้าย', '');
      if (input === null) return;
      const limit = parseInt(input, 10) || Infinity;
      const fmtIn = prompt('บันทึกเป็นไฟล์อะไร? พิมพ์ txt หรือ epub', 'txt');
      if (fmtIn === null) return;
      const fmt = fmtIn.trim().toLowerCase();
      if (fmt !== 'txt' && fmt !== 'epub') { status('เลือกได้เฉพาะ txt หรือ epub'); setTimeout(() => status(''), 2500); return; }

      stop = false;
      $('nlx-all').disabled = true;
      $('nlx-stop').style.display = '';

      const chapters = [];
      let doc = document, raw = null;
      let first = null;
      let count = 0;
      let unknown = 0;

      try {
        while (doc && count < limit && !stop) {
          const c = await extract(doc, raw);
          if (!c) { status('ไม่พบเนื้อหา หยุดที่ตอนที่ ' + (count + 1)); break; }
          if (!first) first = c.title;
          chapters.push({ title: c.title, body: c.body });
          unknown += c.unknown;
          count++;
          status(`ดึงแล้ว ${count} ตอน: ${c.title}`);

          if (!c.next || count >= limit) break;
          await sleep(DELAY_MS);
          const res = await fetch(c.next, { credentials: 'same-origin' });
          if (!res.ok) { status('โหลดไม่สำเร็จ: HTTP ' + res.status); break; }
          raw = await res.text();
          doc = new DOMParser().parseFromString(raw, 'text/html');
        }
      } catch (e) {
        status('ผิดพลาด: ' + e.message);
      }

      if (chapters.length) {
        const novel = document.querySelector('.breadcrumb li:nth-child(2) a')?.textContent.trim() || 'novel';
        const base = safeName(`${novel} - ${first} (${chapters.length} ตอน)`);
        if (fmt === 'epub') {
          downloadBlob(base + '.epub', buildEpub(novel, chapters));
        } else {
          download(base + '.txt', chapters.map(c => `${c.title}\n\n${c.body}`).join('\n\n\n') + '\n');
        }
        status(`เสร็จ ${chapters.length} ตอน (${fmt === 'epub' ? '.epub' : '.txt'})` + (unknown ? ` (ถอดรหัสไม่ได้ ${unknown} ตัว)` : ''));
      }
      $('nlx-all').disabled = false;
      $('nlx-stop').style.display = 'none';
    };
  });
})();