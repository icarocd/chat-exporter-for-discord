(() => {
  if (window.__dcxLoaded) return;
  window.__dcxLoaded = true;

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let running = false;
  let cancel = false;

  const pref = {
    get: (k, d) => { try { const v = localStorage.getItem('dcx_' + k); return v === null ? d : v === '1'; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem('dcx_' + k, v ? '1' : '0'); } catch {} }
  };

  // ---------- UI ----------
  document.getElementById('dcx-box')?.remove(); // old button from a previous load of the extension
  const box = document.createElement('div');
  box.id = 'dcx-box';
  box.style.cssText = 'position:fixed;right:16px;bottom:90px;z-index:99999;font:13px sans-serif;display:flex;flex-direction:column;align-items:flex-end;gap:6px';
  const menu = document.createElement('div');
  menu.style.cssText = 'display:none;flex-direction:column;gap:4px;background:#2b2d31;color:#dbdee1;padding:8px;border-radius:8px;box-shadow:0 4px 12px #0008';
  const status = document.createElement('div');
  status.style.cssText = 'display:none;background:#2b2d31;color:#dbdee1;padding:6px 10px;border-radius:8px;box-shadow:0 4px 12px #0008';
  const btnCss = 'background:#5865f2;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit;text-align:left';
  const mainBtn = document.createElement('button');
  mainBtn.textContent = '⇩ Export';
  mainBtn.style.cssText = btnCss + ';opacity:.75';
  mainBtn.onmouseenter = () => (mainBtn.style.opacity = '1');
  mainBtn.onmouseleave = () => (mainBtn.style.opacity = '.75');

  const addItem = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = btnCss;
    b.onclick = () => { menu.style.display = 'none'; fn(); };
    menu.appendChild(b);
  };
  addItem('Only what is on screen', () => run(0));
  addItem('Last N scrolls...', () => {
    const n = parseInt(prompt('How many times to scroll up?', '20'), 10);
    if (n > 0) run(n);
  });
  addItem('Whole conversation', () => run(Infinity));

  const optLabel = document.createElement('label');
  optLabel.style.cssText = 'display:flex;gap:6px;align-items:center;padding:4px 2px;cursor:pointer';
  const optAtt = document.createElement('input');
  optAtt.type = 'checkbox';
  optAtt.checked = pref.get('att', true);
  optAtt.onchange = () => pref.set('att', optAtt.checked);
  optLabel.append(optAtt, 'Download attachments');
  menu.appendChild(optLabel);

  mainBtn.onclick = () => {
    if (running) { cancel = true; return; }
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
  };
  box.append(menu, status, mainBtn);
  document.body.appendChild(box);
  const setStatus = t => { status.style.display = t ? 'block' : 'none'; status.textContent = t || ''; };

  // ---------- Collect ----------
  function getScroller() {
    const list = document.querySelector('[data-list-id="chat-messages"]');
    if (!list) return null;
    let sc = list.parentElement;
    while (sc && sc.scrollHeight <= sc.clientHeight) sc = sc.parentElement;
    return { list, sc };
  }

  function normUrl(raw) {
    try {
      const u = new URL(raw, location.href);
      ['width', 'height', 'format', 'quality'].forEach(p => u.searchParams.delete(p));
      return u.toString();
    } catch { return raw; }
  }

  function grab(list, msgs) {
    list.querySelectorAll('li[id^="chat-messages-"]').forEach(li => {
      const id = li.id.split('-').pop();
      if (!/^\d+$/.test(id) || msgs.has(id)) return;
      const u = li.querySelector('[id^="message-username-"]');
      const t = li.querySelector('time[id^="message-timestamp-"]') || li.querySelector('time');
      const c = li.querySelector('#message-content-' + id);
      const r = li.querySelector('[id^="message-reply-context-"]');
      const atts = [];
      const seen = new Set();
      li.querySelectorAll('a[href*="/attachments/"], img[src*="/attachments/"], video[src*="/attachments/"], source[src*="/attachments/"]').forEach(e => {
        if (e.closest('[id^="message-reply-context-"]')) return;
        const raw = e.getAttribute('href') || e.getAttribute('src');
        if (!raw) return;
        const url = normUrl(raw);
        let key;
        try { key = new URL(url).pathname; } catch { key = url; }
        if (seen.has(key)) return;
        seen.add(key);
        atts.push({ url, name: decodeURIComponent(key.split('/').pop() || 'file') });
      });
      const sys = !c && !u && !atts.length;
      msgs.set(id, {
        id: BigInt(id),
        author: u ? clean(u.innerText) : null,
        time: t ? t.getAttribute('datetime') : '',
        text: c ? c.innerText.trim() : (sys ? clean(li.innerText) : ''),
        reply: r ? clean(r.innerText) : '',
        atts, sys
      });
    });
  }

  const atBeginning = () =>
    !!document.querySelector('[class*="emptyChannel"], [class*="beginningOf"], [data-list-id="chat-messages"] h3[class*="header"]');

  // ---------- Attachments ----------
  async function fetchBytes(url) {
    try {
      const r = await fetch(url);
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
    } catch {}
    const res = await chrome.runtime.sendMessage({ type: 'fetch', url });
    if (!res || !res.ok) throw new Error((res && res.error) || 'failed');
    const bin = atob(res.b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function downloadAll(arr, files) {
    const jobs = [];
    let n = 0;
    const used = new Set();
    for (const m of arr) for (const a of m.atts) {
      n++;
      let base = a.name.replace(/[\\/:*?"<>|]+/g, '_').slice(-80);
      let path = `attachments/${String(n).padStart(4, '0')}_${base}`;
      while (used.has(path)) path = path.replace(/(\.[^.]*)?$/, '_x$1');
      used.add(path);
      a.path = path;
      jobs.push(a);
    }
    let done = 0, idx = 0;
    const worker = async () => {
      while (idx < jobs.length && !cancel) {
        const a = jobs[idx++];
        try {
          files.push({ name: a.path, data: await fetchBytes(a.url) });
          a.ok = true;
        } catch (e) {
          a.ok = false;
          a.err = String(e.message || e);
        }
        done++;
        setStatus(`Downloading attachments ${done}/${jobs.length}`);
      }
    };
    await Promise.all([1, 2, 3, 4].map(worker));
  }

  // ---------- ZIP (no compression) ----------
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = d => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dtime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const ddate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true); h.setUint16(10, dtime, true); h.setUint16(12, ddate, true);
      h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dtime, true);
      c.setUint16(14, ddate, true); c.setUint32(16, crc, true); c.setUint32(20, size, true);
      c.setUint32(24, size, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
  }

  // ---------- Output ----------
  function buildTxt(arr, header) {
    let last = '';
    const lines = arr.map(m => {
      const d = m.time ? new Date(m.time).toLocaleString() : '';
      if (m.sys) return `[${d}] * ${m.text}`;
      if (m.author) last = m.author;
      let s = `[${d}] ${m.author || last}: ${m.text}`;
      for (const a of m.atts) s += a.ok ? `\n    attachment: ${a.path}` : `\n    attachment (not downloaded${a.err ? ': ' + a.err : ''}): ${a.url}`;
      if (m.reply) s = `  (reply to: ${m.reply})\n` + s;
      return s;
    });
    return header + '\n\n' + lines.join('\n') + '\n';
  }

  function buildHtml(arr, title, header) {
    let last = '';
    const isImg = p => /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(p);
    const isVid = p => /\.(mp4|webm|mov)$/i.test(p);
    const rows = arr.map(m => {
      const d = m.time ? new Date(m.time).toLocaleString() : '';
      if (m.sys) return `<div class="m s"><span class="t">${esc(d)}</span> ${esc(m.text)}</div>`;
      if (m.author) last = m.author;
      let h = '<div class="m">';
      if (m.reply) h += `<div class="r">↪ ${esc(m.reply)}</div>`;
      h += `<span class="t">${esc(d)}</span> <span class="a">${esc(m.author || last)}</span><div class="x">${esc(m.text)}</div>`;
      for (const a of m.atts) {
        if (!a.ok) h += `<div class="f">attachment not downloaded: <a href="${esc(a.url)}">${esc(a.name)}</a></div>`;
        else if (isImg(a.path)) h += `<a href="${esc(a.path)}"><img loading="lazy" src="${esc(a.path)}"></a>`;
        else if (isVid(a.path)) h += `<video controls src="${esc(a.path)}"></video>`;
        else h += `<div class="f">📎 <a href="${esc(a.path)}">${esc(a.name)}</a></div>`;
      }
      return h + '</div>';
    });
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:14px/1.4 sans-serif;max-width:900px;margin:auto;padding:16px;background:#313338;color:#dbdee1}pre{color:#949ba4;white-space:pre-wrap}.m{margin:10px 0}.t{color:#949ba4;font-size:12px}.a{font-weight:bold;color:#fff}.x{white-space:pre-wrap}.r{color:#949ba4;font-size:12px}.s{color:#949ba4;font-style:italic}.f{margin:4px 0}a{color:#00a8fc}img,video{max-width:min(100%,420px);max-height:320px;display:block;margin:4px 0;border-radius:4px}</style></head><body><pre>${esc(header)}</pre>${rows.join('\n')}</body></html>`;
  }

  // ---------- Flow ----------
  async function run(maxScrolls) {
    const s = getScroller();
    if (!s) { alert('Open a Discord conversation first'); return; }
    const { list, sc } = s;
    running = true; cancel = false;
    mainBtn.textContent = '✕ Cancel';
    try {
      const msgs = new Map();
      grab(list, msgs);
      let i = 0, stale = 0;
      while (i < maxScrolls && !cancel && sc) {
        const before = msgs.size;
        sc.scrollTop = 0;
        await wait(1000);
        grab(list, msgs);
        i++;
        setStatus(`Scroll ${i}${isFinite(maxScrolls) ? '/' + maxScrolls : ''}: ${msgs.size} messages`);
        if (msgs.size === before) {
          stale++;
          if (atBeginning() || stale >= 4) break;
          await wait(1500);
        } else stale = 0;
      }
      const partialScroll = cancel;
      cancel = false;

      const arr = [...msgs.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
      const files = [];
      if (optAtt.checked) await downloadAll(arr, files);
      const partial = partialScroll || cancel;

      const title = clean(document.title.replace(/^Discord\s*\|\s*/, '')) || 'conversation';
      const nAtt = arr.reduce((s, m) => s + m.atts.length, 0);
      const nOk = arr.reduce((s, m) => s + m.atts.filter(a => a.ok).length, 0);
      const header = `${title}\n${location.href}\nExported at ${new Date().toLocaleString()}${partial ? ' (partial)' : ''}\n${arr.length} messages, ${nAtt} attachments (${nOk} downloaded)`;
      const enc = new TextEncoder();
      files.unshift(
        { name: 'conversation.txt', data: enc.encode(buildTxt(arr, header)) },
        { name: 'conversation.html', data: enc.encode(buildHtml(arr, title, header)) }
      );

      const safe = title.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'conversation';
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(makeZip(files));
      a.download = `discord_${safe}_${stamp}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      setStatus(`Exported ${arr.length} messages and ${nOk}/${nAtt} attachments${partial ? ' (partial)' : ''}`);
    } catch (e) {
      setStatus('Error: ' + (e.message || e));
    } finally {
      running = false;
      mainBtn.textContent = '⇩ Export';
      setTimeout(() => setStatus(''), 8000);
    }
  }
})();
