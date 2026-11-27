const { chromium } = require('playwright'); const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/`(.+?)`/g,'<code>$1</code>');
const lines = fs.readFileSync(src,'utf8').split('\n'); let html = '', i = 0;
while (i < lines.length) {
  const l = lines[i];
  if (/^\|/.test(l)) {
    const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
    const cells = r => r.replace(/^\||\|$/g,'').split('|').map(c => c.trim());
    html += '<table><thead><tr>' + cells(rows[0]).map(c=>`<th>${inl(c)}</th>`).join('') + '</tr></thead><tbody>';
    for (const r of rows.slice(2)) { const c = cells(r); html += `<tr class="${c[0] ? 'first' : 'cont'}">` + c.map(x=>`<td>${inl(x)}</td>`).join('') + '</tr>'; }
    html += '</tbody></table>'; continue;
  }
  if (/^- /.test(l)) { html += '<ul>'; while (i < lines.length && /^- /.test(lines[i])) html += `<li>${inl(lines[i++].slice(2))}</li>`; html += '</ul>'; continue; }
  const h = /^(#{1,3}) (.*)/.exec(l);
  if (h) html += `<h${h[1].length}>${inl(h[2])}</h${h[1].length}>`; else if (l.trim()) html += `<p>${inl(l)}</p>`;
  i++;
}
const page = `<!doctype html><meta charset="utf-8"><style>
body{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:9.5px;color:#111;margin:0}
h1{font-size:16px;margin:0 0 10px} h2{font-size:13px;margin:18px 0 6px;page-break-after:avoid}
table{border-collapse:collapse;width:100%;margin-bottom:8px} th,td{border:1px solid #ccc;padding:2px 4px;text-align:left;vertical-align:top}
th{background:#eee} tr{page-break-inside:avoid} tr.first td{border-top:1.5px solid #888}
code{font-family:Menlo,monospace;font-size:8.5px} p{margin:4px 0} ul{margin:4px 0 0 16px;padding:0}
</style>${html}`;
(async()=>{const b=await chromium.launch();const p=await b.newPage();await p.setContent(page);
await p.pdf({path:dst,format:'A4',landscape:true,margin:{top:'12mm',bottom:'12mm',left:'10mm',right:'10mm'},printBackground:true,
 displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;width:100%;text-align:center;color:#888"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
await b.close();})();
