/* Anbudsläget – statisk klient. Läser JSON under data/ som GitHub Action uppdaterar. */
(() => {
  "use strict";

  const CPV = {
    "03": "Jordbruk & livsmedelsråvaror", "09": "Bränslen & energi", "14": "Gruv- & mineralprodukter",
    "15": "Livsmedel & drycker", "16": "Jordbruksmaskiner", "18": "Kläder & skor", "19": "Textil & läder",
    "22": "Trycksaker", "24": "Kemikalier", "30": "Kontorsmaskiner & datorer", "31": "Elutrustning",
    "32": "Radio, tv & telekom", "33": "Medicinteknik & läkemedel", "34": "Fordon & transportutrustning",
    "35": "Säkerhets-, brand- & försvarsutrustning", "37": "Musik, sport & fritid", "38": "Laboratorie- & precisionsutrustning",
    "39": "Möbler & inredning", "41": "Vatten", "42": "Industrimaskiner", "43": "Gruv- & byggmaskiner",
    "44": "Byggmaterial & konstruktioner", "45": "Bygg & anläggning", "48": "Programvara & IT-system",
    "50": "Reparation & underhåll", "51": "Installation", "55": "Hotell, restaurang & catering",
    "60": "Transporter", "63": "Transportstöd & resebyrå", "64": "Post & telekom", "65": "Allmännyttiga tjänster",
    "66": "Finans & försäkring", "70": "Fastighetstjänster", "71": "Arkitekt- & ingenjörstjänster",
    "72": "IT-tjänster", "73": "Forskning & utveckling", "75": "Offentlig förvaltning & försvar",
    "76": "Olje- & gastjänster", "77": "Jord-, skogsbruk & trädgård", "79": "Företagstjänster",
    "80": "Utbildning", "85": "Vård & omsorg", "90": "Avfall, städ & miljö", "92": "Kultur & sport",
    "98": "Övriga tjänster"
  };
  const LAN = ["Blekinge län","Dalarnas län","Gotlands län","Gävleborgs län","Hallands län","Jämtlands län","Jönköpings län","Kalmar län","Kronobergs län","Norrbottens län","Skåne län","Stockholms län","Södermanlands län","Uppsala län","Värmlands län","Västerbottens län","Västernorrlands län","Västmanlands län","Västra Götalands län","Örebro län","Östergötlands län"];

  const app = document.getElementById("app");
  const cache = {};
  const store = {
    get(k, d) { try { const v = localStorage.getItem("al:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("al:" + k, JSON.stringify(v)); } catch {} }
  };

  // ---------- data ----------
  async function load(name) {
    if (!cache[name]) {
      cache[name] = fetch("data/" + name + ".json", { cache: "no-cache" })
        .then(r => r.ok ? r.json() : (name === "meta" ? null : []))
        .catch(() => (name === "meta" ? null : []));
    }
    return cache[name];
  }
  async function loadWatchDefaults() {
    if (!cache.watches) cache.watches = fetch("watches.json").then(r => r.ok ? r.json() : []).catch(() => []);
    return cache.watches;
  }
  async function archive() {
    if (!cache.archive) {
      cache.archive = (async () => {
        const meta = await load("meta");
        const months = (meta && meta.months) || [];
        const parts = await Promise.all(months.map(m => fetch("data/months/" + m + ".json").then(r => r.ok ? r.json() : []).catch(() => [])));
        return parts.flat();
      })();
    }
    return cache.archive;
  }

  // ---------- format ----------
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const MONTH = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];
  function fdate(d, year) {
    if (!d) return "–";
    const [y, m, dd] = d.split("-").map(Number);
    const showY = year || y !== new Date().getFullYear();
    return `${dd} ${MONTH[m - 1]}${showY ? " " + y : ""}`;
  }
  function money(v, cur) {
    if (v == null || !isFinite(v) || v < 100) return "";
    const c = cur && cur !== "SEK" ? " " + cur : "";
    const f = (x, dec) => x.toLocaleString("sv-SE", { maximumFractionDigits: dec });
    if (v >= 1e9) return f(v / 1e9, 1) + " mdkr" + c;
    if (v >= 1e6) return f(v / 1e6, v >= 1e7 ? 0 : 1) + " mkr" + c;
    if (v >= 1e3) return f(v / 1e3, 0) + " tkr" + c;
    return f(v, 0) + " kr" + c;
  }
  const n0 = x => (x ?? 0).toLocaleString("sv-SE");
  function daysLeft(d) {
    if (!d) return null;
    return Math.round((new Date(d + "T12:00:00") - new Date(today() + "T12:00:00")) / 864e5);
  }
  const catOf = n => (n.c && n.c[0]) ? n.c[0].slice(0, 2) : null;
  const catName = c => CPV[c] || (c ? "CPV " + c : "");
  const tedUrl = id => "https://ted.europa.eu/sv/notice/-/detail/" + encodeURIComponent(id);

  // ---------- komponenter ----------
  function row(n) {
    const dl = daysLeft(n.d);
    let stamp = "";
    if (n.r) stamp = `<span class="stamp done">Avgjord</span>`;
    else if (dl != null && dl >= 0) stamp = `<span class="stamp${dl <= 7 ? " urgent" : ""}">${dl === 0 ? "Sista dag i dag" : dl + " dagar kvar"}</span>`;
    else if (dl != null && dl < 0) stamp = `<span class="stamp done">Stängd</span>`;
    const cat = catOf(n);
    const meta = [
      n.b ? `<a href="#/k/${encodeURIComponent(n.bk)}">${esc(n.b)}</a>` : "",
      cat ? `<a href="#/sok?cat=${cat}">${esc(catName(cat))}</a>` : "",
      (n.l || []).map(esc).join(", "),
      n.r ? `${n.nb != null ? n.nb + " anbud" : "antal anbud saknas"}` : (n.d ? `sista dag ${fdate(n.d)}` : ""),
      `publ. ${fdate(n.p)}`
    ].filter(Boolean).map(x => `<span>${x}</span>`).join("");
    const win = n.r && n.w && n.w.length
      ? `<div class="win">Vinnare: ${n.w.slice(0, 5).map(w => `<a href="#/l/${encodeURIComponent(w.k)}"><b>${esc(w.n)}</b></a>`).join(", ")}${n.w.length > 5 ? ` + ${n.w.length - 5} till` : ""}</div>` : "";
    return `<li><a class="row-t" href="#/u/${encodeURIComponent(n.id)}">${esc(n.t)}</a>
      <div class="row-side">${stamp}<span class="val">${esc(money(n.v, n.vc))}</span></div>
      <div class="row-meta">${meta}</div>${win}</li>`;
  }
  const rows = (list, empty) => list.length ? `<ol class="rows">${list.map(row).join("")}</ol>` : `<div class="empty">${empty}</div>`;

  function noData() {
    return `<div class="empty"><h2>Kunde inte läsa in data</h2><p>Sajten uppdateras troligen just nu. Vänta en minut och <a href="" onclick="location.reload();return false">ladda om sidan</a>. Kvarstår det har den dagliga importen från TED inte gått igenom; se fliken <b>Actions</b> i GitHub-repot.</p></div>`;
  }

  // ---------- vyer ----------
  async function viewHome() {
    const [meta, open, awards] = await Promise.all([load("meta"), load("open"), load("awards")]);
    if (!meta) return noData();
    const c = meta.counts || {};
    const cats = {};
    open.forEach(n => { const k = catOf(n); if (k) cats[k] = (cats[k] || 0) + 1; });
    const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const hits = await watchHits();
    const newHits = hits.reduce((s, h) => s + h.fresh.length, 0);
    return `
      <section>
        <span class="eyebrow">Offentlig upphandling i Sverige</span>
        <h1>Vad som är ute just nu, och vem som vinner.</h1>
        ${searchBar("")}
        <div class="chips">${["informationssäkerhet","cybersäkerhet","dataskydd","säkerhetsskydd","krisberedskap","IT-konsult","riskanalys"].map(t => `<a class="chip" href="#/sok?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div>
      </section>
      <div class="stats" role="list">
        <div role="listitem"><b>${n0(c.open)}</b><span>öppna upphandlingar</span></div>
        <div role="listitem"><b>${n0(c.new7)}</b><span>nya senaste 7 dagarna</span></div>
        <div role="listitem"><b>${n0(newHits)}</b><span><a href="#/bevakning">nya träffar i dina bevakningar</a></span></div>
        <div role="listitem"><b>${n0(c.suppliers)}</b><span>leverantörer med vinster</span></div>
      </div>
      <section>
        <div class="sec-head"><h2>Senast publicerade</h2><a href="#/sok">Alla ${n0(open.length)} öppna →</a></div>
        ${rows(open.slice(0, 10), "Inga öppna upphandlingar just nu.")}
      </section>
      <section>
        <div class="sec-head"><h2>Nyligen avgjorda</h2><a href="#/sok?st=res">Fler →</a></div>
        ${rows(awards.filter(a => a.w && a.w.length).slice(0, 6), "Inga tilldelningar senaste tiden.")}
      </section>
      <section>
        <h2>Öppna per bransch</h2>
        <ul class="cats">${topCats.map(([k, v]) => `<li><a href="#/sok?cat=${k}">${esc(catName(k))}<span>${v}</span></a></li>`).join("")}</ul>
      </section>`;
  }

  function searchBar(q) {
    return `<form class="searchbar" id="sform" role="search">
      <input type="search" id="q" name="q" value="${esc(q)}" placeholder="Sök titel, köpare eller beskrivning" aria-label="Sök">
      <button class="btn" type="submit">Sök</button></form>`;
  }

  async function viewSearch(p) {
    const st = p.get("st") || "open";
    const q = (p.get("q") || "").trim();
    const cat = p.get("cat") || "";
    const lan = p.get("lan") || "";
    const minv = Number(p.get("min") || 0);
    const sort = p.get("sort") || "pub";
    const meta = await load("meta");
    if (!meta) return noData();
    let list;
    if (st === "open") list = await load("open");
    else {
      const all = await archive();
      list = all.filter(n => st === "res" ? n.r : true);
    }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter(n => {
      if (cat && catOf(n) !== cat && !(n.c || []).some(c => c.startsWith(cat))) return false;
      if (lan && !(n.l || []).includes(lan)) return false;
      if (minv && !(n.v >= minv)) return false;
      if (terms.length) {
        const hay = `${n.t} ${n.b || ""} ${n.ds || ""} ${(n.w || []).map(w => w.n).join(" ")} ${(n.c || []).join(" ")}`.toLowerCase();
        return terms.every(t => hay.includes(t));
      }
      return true;
    });
    if (sort === "dl") list = [...list].sort((a, b) => (a.d || "9999").localeCompare(b.d || "9999"));
    else if (sort === "val") list = [...list].sort((a, b) => (b.v || 0) - (a.v || 0));
    else list = [...list].sort((a, b) => (b.p || "").localeCompare(a.p || ""));
    const shown = list.slice(0, 200);
    const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
    return `
      <section>
        <h1>Sök upphandlingar</h1>
        <form id="filters" class="filters">
          <input type="search" id="fq" name="q" value="${esc(q)}" placeholder="Sökord" aria-label="Sökord">
          <select id="fst" name="st" aria-label="Status">${opt("open", st, "Öppna")}${opt("res", st, "Avgjorda (vinnare)")}${opt("all", st, "Alla i arkivet")}</select>
          <select id="fcat" name="cat" aria-label="Bransch"><option value="">Alla branscher</option>${Object.entries(CPV).map(([k, v]) => opt(k, cat, v)).join("")}</select>
          <select id="flan" name="lan" aria-label="Län"><option value="">Alla län</option>${LAN.map(l => opt(l, lan, l)).join("")}</select>
          <select id="fmin" name="min" aria-label="Minsta värde">${[["0","Alla värden"],["1000000","Från 1 mkr"],["10000000","Från 10 mkr"],["100000000","Från 100 mkr"]].map(([v, l]) => opt(v, String(minv || 0), l)).join("")}</select>
          <select id="fsort" name="sort" aria-label="Sortering">${opt("pub", sort, "Senast publicerad")}${opt("dl", sort, "Närmast sista dag")}${opt("val", sort, "Högst värde")}</select>
        </form>
        <p class="note">${n0(list.length)} träffar${list.length > 200 ? ", visar de 200 första" : ""}. ${st !== "open" ? "Arkivet täcker de månader som importerats." : ""}</p>
      </section>
      ${rows(shown, "Inga träffar. Prova färre sökord eller bredare filter.")}`;
  }

  async function findNotice(id) {
    const [open, awards] = await Promise.all([load("open"), load("awards")]);
    return open.find(n => n.id === id) || awards.find(n => n.id === id) || (await archive()).find(n => n.id === id);
  }

  async function viewNotice(id) {
    const n = await findNotice(id);
    if (!n) return `<div class="empty">Hittar inte annons ${esc(id)}. <a href="${tedUrl(id)}" target="_blank" rel="noopener">Öppna i TED</a>.</div>`;
    const dl = daysLeft(n.d);
    const cat = catOf(n);
    const all = await archive();
    const related = n.bk ? all.filter(x => x.bk === n.bk && x.id !== n.id).sort((a, b) => (b.p || "").localeCompare(a.p || "")).slice(0, 6) : [];
    const fact = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : "";
    return `
      <section>
        <span class="eyebrow">${n.r ? "Tilldelning" : "Upphandling"} · <span class="mono">${esc(n.id)}</span></span>
        <h1>${esc(n.t)}</h1>
        <dl class="facts">
          ${fact("Köpare", n.b ? `<a href="#/k/${encodeURIComponent(n.bk)}">${esc(n.b)}</a>${n.bo ? ` <span class="mono muted">${esc(n.bo)}</span>` : ""}` : "")}
          ${fact("Bransch", cat ? `<a href="#/sok?cat=${cat}">${esc(catName(cat))}</a>` : "")}
          ${fact("CPV", (n.c || []).map(c => `<span class="mono">${esc(c)}</span>`).join(", "))}
          ${fact("Län", (n.l || []).map(esc).join(", "))}
          ${fact("Publicerad", fdate(n.p, true))}
          ${fact("Sista anbudsdag", n.d ? `${fdate(n.d, true)}${!n.r && dl != null && dl >= 0 ? ` (${dl} dagar kvar)` : ""}` : "")}
          ${fact(n.r ? "Kontraktsvärde" : "Uppskattat värde", esc(money(n.v, n.vc)))}
          ${fact("Antal anbud", n.nb != null ? String(n.nb) : "")}
          ${fact("Avtal tecknat", n.cd ? fdate(n.cd, true) : "")}
          ${fact("Vinnare", (n.w || []).map(w => `<a href="#/l/${encodeURIComponent(w.k)}">${esc(w.n)}</a>${w.o ? ` <span class="mono muted">${esc(w.o)}</span>` : ""}`).join("<br>"))}
          ${fact("Annonstyp", esc(n.ty))}
        </dl>
        ${n.ds ? `<p class="desc">${esc(n.ds)}${n.ds.length >= 600 ? "…" : ""}</p>` : ""}
        <p><a class="btn" href="${tedUrl(n.id)}" target="_blank" rel="noopener">Öppna annonsen i TED</a></p>
      </section>
      ${related.length ? `<section><h2>Mer från ${esc(n.b)}</h2>${rows(related, "")}</section>` : ""}`;
  }

  async function viewBuyers(p) {
    const buyers = await load("buyers");
    if (!buyers.length) return noData();
    const q = (p.get("q") || "").toLowerCase();
    const list = (q ? buyers.filter(b => b.n.toLowerCase().includes(q) || (b.o || "").includes(q)) : buyers).slice(0, 150);
    return `<section><h1>Köpare</h1>
      <form class="searchbar" id="lform"><input type="search" id="lq" name="q" value="${esc(q)}" placeholder="Sök kommun, region, myndighet eller bolag" aria-label="Sök köpare"><button class="btn" type="submit">Sök</button></form>
      <div class="table-wrap"><table><thead><tr><th>Köpare</th><th class="n">Öppna</th><th class="n">Avgjorda</th><th class="n">Snitt anbud</th></tr></thead><tbody>
      ${list.map(b => `<tr><td><a href="#/k/${encodeURIComponent(b.k)}">${esc(b.n)}</a></td><td class="n">${b.open || ""}</td><td class="n">${b.res || ""}</td><td class="n">${b.avgBids ?? ""}</td></tr>`).join("")}
      </tbody></table></div></section>`;
  }

  async function viewBuyer(key) {
    const [buyers, suppliers, all] = await Promise.all([load("buyers"), load("suppliers"), archive()]);
    const b = buyers.find(x => x.k === key);
    const items = all.filter(n => n.bk === key).sort((a, c) => (c.p || "").localeCompare(a.p || ""));
    if (!b && !items.length) return `<div class="empty">Hittar inte köparen.</div>`;
    const name = b ? b.n : items[0].b;
    const sName = k => (suppliers.find(s => s.k === k) || {}).n || k;
    const open = items.filter(n => !n.r && n.d && n.d >= today());
    const res = items.filter(n => n.r);
    return `<section><span class="eyebrow">Köpare${b && b.o ? ` · <span class="mono">${esc(b.o)}</span>` : ""}</span><h1>${esc(name)}</h1>
      <div class="stats"><div><b>${open.length}</b><span>öppna nu</span></div><div><b>${res.length}</b><span>avgjorda i arkivet</span></div><div><b>${b && b.avgBids != null ? b.avgBids : "–"}</b><span>anbud i snitt</span></div><div><b>${esc(money(b && b.val)) || "–"}</b><span>tilldelat värde</span></div></div></section>
      ${b && b.topWin && b.topWin.length ? `<section><h2>Vinner oftast här</h2><div class="table-wrap"><table><tbody>${b.topWin.map(([k, c]) => `<tr><td><a href="#/l/${encodeURIComponent(k)}">${esc(sName(k))}</a></td><td class="n">${c} vinster</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      <section><h2>Öppna upphandlingar</h2>${rows(open, "Inga öppna upphandlingar just nu.")}</section>
      <section><h2>Avgjorda</h2>${rows(res.slice(0, 40), "Inga avgjorda i arkivet.")}</section>`;
  }

  async function viewSuppliers(p) {
    const sup = await load("suppliers");
    if (!sup.length) return noData();
    const q = (p.get("q") || "").toLowerCase();
    const list = (q ? sup.filter(s => s.n.toLowerCase().includes(q) || (s.o || "").includes(q)) : sup).slice(0, 150);
    return `<section><h1>Leverantörer</h1><p class="lead">Vilka som vinner, hur ofta och mot hur många anbud. Sök på konkurrenter eller partners.</p>
      <form class="searchbar" id="lform"><input type="search" id="lq" name="q" value="${esc(q)}" placeholder="Företagsnamn eller organisationsnummer" aria-label="Sök leverantör"><button class="btn" type="submit">Sök</button></form>
      <div class="table-wrap"><table><thead><tr><th>Leverantör</th><th class="n">Vinster</th><th class="n">Snitt anbud</th><th class="n">Värde (andel)</th><th class="n">Senast</th></tr></thead><tbody>
      ${list.map(s => `<tr><td><a href="#/l/${encodeURIComponent(s.k)}">${esc(s.n)}</a></td><td class="n">${s.wins}</td><td class="n">${s.avgBids ?? ""}</td><td class="n">${esc(money(s.val))}</td><td class="n">${fdate(s.last)}</td></tr>`).join("")}
      </tbody></table></div></section>`;
  }

  async function viewSupplier(key) {
    const [sup, buyers, all] = await Promise.all([load("suppliers"), load("buyers"), archive()]);
    const s = sup.find(x => x.k === key);
    const wins = all.filter(n => n.r && (n.w || []).some(w => w.k === key)).sort((a, b) => (b.p || "").localeCompare(a.p || ""));
    if (!s && !wins.length) return `<div class="empty">Hittar inte leverantören.</div>`;
    const name = s ? s.n : wins[0].w.find(w => w.k === key).n;
    const bName = k => (buyers.find(b => b.k === k) || {}).n || k;
    return `<section><span class="eyebrow">Leverantör${s && s.o ? ` · <span class="mono">${esc(s.o)}</span>` : ""}</span><h1>${esc(name)}</h1>
      <div class="stats"><div><b>${wins.length}</b><span>vinster i arkivet</span></div><div><b>${s && s.avgBids != null ? s.avgBids : "–"}</b><span>anbud i snitt där de vann</span></div><div><b>${esc(money(s && s.val)) || "–"}</b><span>värde (delat vid flera vinnare)</span></div><div><b>${fdate(s && s.last)}</b><span>senaste vinst</span></div></div></section>
      ${s && s.topBuyers && s.topBuyers.length ? `<section><h2>Största kunder</h2><div class="table-wrap"><table><tbody>${s.topBuyers.map(([k, c]) => `<tr><td><a href="#/k/${encodeURIComponent(k)}">${esc(bName(k))}</a></td><td class="n">${c} vinster</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      <section><h2>Vunna upphandlingar</h2>${rows(wins.slice(0, 60), "Inga vinster i arkivet.")}</section>`;
  }

  // ---------- signaler (rekryteringar från Platsbanken) ----------
  async function viewSignals(p) {
    const [jobs, jmeta, buyers, open] = await Promise.all([load("jobs"), load("jobs-meta"), load("buyers"), load("open")]);
    if (!jobs.length) return `<section><h1>Signaler</h1><div class="empty">Inga rekryteringssignaler ännu. De hämtas från Platsbanken vid nästa morgonkörning.</div></section>`;
    const cat = p.get("cat") || "", lan = p.get("lan") || "", sek = p.get("sek") || "", st = p.get("st") || "open";
    const q = (p.get("q") || "").toLowerCase();
    const cats = [...new Set(jobs.flatMap(j => j.cat))].sort();
    const byOrg = {}, byKey = {};
    buyers.forEach(b => { if (b.o) byOrg[b.o] = b; byKey[b.k] = b; });
    const openByBuyer = {};
    open.forEach(n => { if (n.bk) openByBuyer[n.bk] = (openByBuyer[n.bk] || 0) + 1; });
    let list = jobs.filter(j => (st === "all" || j.open) && (!cat || j.cat.includes(cat)) && (!lan || j.l === lan)
      && (!sek || (sek === "off" ? j.pub : !j.pub))
      && (!q || `${j.t} ${j.e} ${j.m || ""} ${j.occ || ""}`.toLowerCase().includes(q)));
    const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
    const newCount = jobs.filter(j => j.open && j.first >= new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)).length;
    const pubCount = jobs.filter(j => j.open && j.pub).length;
    const items = list.slice(0, 250).map(j => {
      const b = (j.eo && byOrg[j.eo]) || byKey[j.ek];
      const ob = b ? openByBuyer[b.k] || 0 : 0;
      const dl = daysLeft(j.d);
      const stamp = !j.open ? `<span class="stamp done">Avslutad</span>` : (dl != null && dl >= 0 ? `<span class="stamp${dl <= 7 ? " urgent" : ""}">${dl === 0 ? "Sista dag i dag" : dl + " dagar kvar"}</span>` : "");
      const meta = [
        b ? `<a href="#/k/${encodeURIComponent(b.k)}">${esc(j.e)}</a>` : esc(j.e),
        esc(j.cat.join(", ")),
        esc([j.m, j.l].filter(Boolean).join(", ")),
        j.et ? esc(j.et) : "",
        `publ. ${fdate(j.p || j.first)}`
      ].filter(Boolean).map(x => `<span>${x}</span>`).join("");
      const link = b ? `<div class="win">${ob ? `<b>${ob} öppna upphandlingar</b> hos samma organisation · ` : ""}<a href="#/k/${encodeURIComponent(b.k)}">köparprofil</a>${b.res ? ` · ${b.res} avgjorda` : ""}</div>` : "";
      return `<li><a class="row-t" href="${esc(j.u)}" target="_blank" rel="noopener">${esc(j.t)}</a>
        <div class="row-side">${stamp}<span class="note">${j.pub ? "Offentlig" : "Privat"}</span></div>
        <div class="row-meta">${meta}</div>${link}</li>`;
    }).join("");
    return `<section><span class="eyebrow">Behovsradar · Platsbanken</span><h1>Vem rekryterar säkerhet just nu?</h1>
        <p class="lead">Organisationer som söker personal inom säkerhet, beredskap, dataskydd och risk har ett behov nu. Ofta behövs stöd innan tjänsten är tillsatt.</p></section>
      <div class="stats"><div><b>${n0(jobs.filter(j => j.open).length)}</b><span>aktuella annonser</span></div><div><b>${n0(newCount)}</b><span>nya senaste 7 dagarna</span></div><div><b>${n0(pubCount)}</b><span>i offentlig sektor</span></div><div><b>${jmeta && jmeta.updatedAt ? fdate(jmeta.updatedAt.slice(0, 10)) : "–"}</b><span>senast hämtat</span></div></div>
      <section>
        <form id="sigform" class="filters">
          <input type="search" id="sq" name="q" value="${esc(q)}" placeholder="Arbetsgivare, ort eller titel" aria-label="Sök">
          <select id="scat" name="cat" aria-label="Kategori"><option value="">Alla kategorier</option>${cats.map(c => opt(c, cat, c)).join("")}</select>
          <select id="slan" name="lan" aria-label="Län"><option value="">Alla län</option>${LAN.map(l => opt(l, lan, l)).join("")}</select>
          <select id="ssek" name="sek" aria-label="Sektor">${opt("", sek, "Alla sektorer")}${opt("off", sek, "Offentlig")}${opt("priv", sek, "Privat")}</select>
          <select id="sst" name="st" aria-label="Status">${opt("open", st, "Aktuella")}${opt("all", st, "Även avslutade")}</select>
        </form>
        <p class="note">${n0(list.length)} annonser. Sektor gissas utifrån arbetsgivarens namn. Länk till köparprofil visas när arbetsgivaren också upphandlar via TED.</p>
      </section>
      ${items ? `<ol class="rows">${items}</ol>` : `<div class="empty">Inga annonser matchar filtret.</div>`}`;
  }

  // ---------- kundkort (Kolada + upphandlingar + signaler) ----------
  const LANKOD = {"01":"Stockholms län","03":"Uppsala län","04":"Södermanlands län","05":"Östergötlands län","06":"Jönköpings län","07":"Kronobergs län","08":"Kalmar län","09":"Gotlands län","10":"Blekinge län","12":"Skåne län","13":"Hallands län","14":"Västra Götalands län","17":"Värmlands län","18":"Örebro län","19":"Västmanlands län","20":"Dalarnas län","21":"Gävleborgs län","22":"Västernorrlands län","23":"Jämtlands län","24":"Västerbottens län","25":"Norrbottens län"};
  const slugify = s => (s || "").toLowerCase().replace(/å|ä/g, "a").replace(/ö/g, "o").replace(/é/g, "e").replace(/ü/g, "u").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const muniLan = m => m.ty === "L" ? LANKOD[m.id.slice(2)] : LANKOD[m.id.slice(0, 2)];
  function orgKeys(m) {
    const t = slugify(m.t);
    if (m.ty === "L") return [t];
    const gen = t.endsWith("s") ? t : t + "s";
    return [t + "-kommun", gen + "-kommun", t + "-stad", gen + "-stad", "kommunstyrelsen-i-" + t];
  }
  const matchesOrg = (key, keys) => !!key && keys.some(k => key === k || key.startsWith(k + "-"));
  function fmtKpi(v, title) {
    if (v == null) return "–";
    const pct = /%/.test(title || "");
    const dec = pct || Math.abs(v) < 100 ? 1 : 0;
    return v.toLocaleString("sv-SE", { maximumFractionDigits: dec, minimumFractionDigits: pct ? 1 : 0 }) + (pct ? " %" : "");
  }

  async function viewCards(p) {
    const k = await load("kolada");
    if (!k || !k.munis) return `<section><h1>Kundkort</h1><div class="empty">Nyckeltal från Kolada hämtas vid nästa morgonkörning.</div></section>`;
    const q = (p.get("q") || "").toLowerCase(), lan = p.get("lan") || "Skåne län", ty = p.get("ty") || "";
    const [open, jobs] = await Promise.all([load("open"), load("jobs")]);
    const list = k.munis.filter(m => m.id !== "0000" && (!lan || lan === "alla" || muniLan(m) === lan) && (!ty || m.ty === ty) && (!q || m.t.toLowerCase().includes(q)));
    const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
    const rowsH = list.map(m => {
      const keys = orgKeys(m);
      const o = open.filter(n => matchesOrg(n.bk, keys)).length;
      const j = jobs.filter(x => x.open && matchesOrg(x.ek, keys)).length;
      const inv = ((k.values[m.id] || {}).N01951 || []).slice(-1)[0];
      return `<tr><td><a href="#/kort/${m.id}">${esc(m.ty === "L" ? m.t : m.t + " kommun")}</a></td><td class="n">${inv ? n0(inv[1]) : ""}</td><td class="n">${o || ""}</td><td class="n">${j || ""}</td></tr>`;
    }).join("");
    return `<section><span class="eyebrow">Kolada · TED · Platsbanken</span><h1>Kundkort</h1>
      <p class="lead">En sida per kommun och region med nyckeltal, upphandlingar, vinnare och pågående rekryteringar. Underlag inför möten.</p>
      <form id="cardform" class="filters">
        <input type="search" id="cq" name="q" value="${esc(q)}" placeholder="Kommun eller region" aria-label="Sök">
        <select id="clan" name="lan" aria-label="Län">${opt("alla", lan, "Hela landet")}${LAN.map(l => opt(l, lan, l)).join("")}</select>
        <select id="cty" name="ty" aria-label="Typ">${opt("", ty, "Kommuner och regioner")}${opt("K", ty, "Kommuner")}${opt("L", ty, "Regioner")}</select>
      </form></section>
      <div class="table-wrap"><table><thead><tr><th>Organisation</th><th class="n">Invånare</th><th class="n">Öppna upph.</th><th class="n">Rekryterar</th></tr></thead><tbody>${rowsH}</tbody></table></div>`;
  }

  async function viewCard(id) {
    const [k, open, buyers, suppliers, jobs, all] = await Promise.all([load("kolada"), load("open"), load("buyers"), load("suppliers"), load("jobs"), archive()]);
    const m = k && k.munis && k.munis.find(x => x.id === id);
    if (!m) return `<div class="empty">Hittar inte kommunen eller regionen.</div>`;
    const name = m.ty === "L" ? m.t : m.t + " kommun";
    const keys = orgKeys(m);
    const vals = k.values[m.id] || {}, riket = k.values["0000"] || {};
    const kpiRows = (k.kpis[m.ty] || []).filter(kid => k.meta[kid]).map(kid => {
      const me = k.meta[kid], s = vals[kid] || [], last = s[s.length - 1], prev = s[s.length - 2];
      const r = (riket[kid] || []).find(x => last && x[0] === last[0]) || (riket[kid] || []).slice(-1)[0];
      const trend = last && prev ? (last[1] > prev[1] ? "↑" : last[1] < prev[1] ? "↓" : "→") : "";
      return `<tr><td><b>${esc(me.short)}</b><div class="note">${esc(me.title)}</div></td>
        <td class="n">${fmtKpi(last && last[1], me.title)} <span class="muted">${trend}</span></td>
        <td class="n">${last ? last[0] : ""}</td>
        <td class="n">${kid === "N01951" || kid === "N00231" ? "" : fmtKpi(r && r[1], me.title)}</td></tr>`;
    }).join("");
    const mine = all.filter(n => matchesOrg(n.bk, keys));
    const openN = open.filter(n => matchesOrg(n.bk, keys)).sort((a, b) => (b.p || "").localeCompare(a.p || ""));
    const res = mine.filter(n => n.r).sort((a, b) => (b.p || "").localeCompare(a.p || ""));
    const wins = {};
    res.forEach(n => (n.w || []).forEach(w => { wins[w.k] = wins[w.k] || { n: w.n, c: 0 }; wins[w.k].c++; }));
    const topW = Object.entries(wins).sort((a, b) => b[1].c - a[1].c).slice(0, 8);
    const units = buyers.filter(b => matchesOrg(b.k, keys));
    const bids = res.filter(n => n.nb != null).map(n => n.nb);
    const avgBids = bids.length ? (bids.reduce((a, b) => a + b, 0) / bids.length).toFixed(1).replace(".", ",") : "–";
    const sig = jobs.filter(x => matchesOrg(x.ek, keys)).sort((a, b) => b.open - a.open || (b.p || "").localeCompare(a.p || ""));
    return `<section><span class="eyebrow">${m.ty === "L" ? "Region" : "Kommun"} · ${esc(muniLan(m) || "")} · Kolada-id <span class="mono">${esc(m.id)}</span></span><h1>${esc(name)}</h1></section>
      <div class="stats"><div><b>${openN.length}</b><span>öppna upphandlingar</span></div><div><b>${res.length}</b><span>avgjorda senaste året</span></div><div><b>${avgBids}</b><span>anbud i snitt</span></div><div><b>${sig.filter(x => x.open).length}</b><span>rekryteringar inom säkerhet</span></div></div>
      <section><h2>Nyckeltal</h2><div class="table-wrap"><table><thead><tr><th>Mått</th><th class="n">Värde</th><th class="n">År</th><th class="n">Riket</th></tr></thead><tbody>${kpiRows || `<tr><td colspan="4" class="muted">Inga nyckeltal hämtade.</td></tr>`}</tbody></table></div>
        <p class="note">Källa: Kolada (RKA). Pilen visar förändring mot föregående år. Hämtat ${esc((k.updatedAt || "").slice(0, 10))}.</p></section>
      ${sig.length ? `<section><h2>Rekryterar inom säkerhet och beredskap</h2><ol class="rows">${sig.slice(0, 10).map(j => `<li><a class="row-t" href="${esc(j.u)}" target="_blank" rel="noopener">${esc(j.t)}</a><div class="row-side">${j.open ? "" : `<span class="stamp done">Avslutad</span>`}</div><div class="row-meta"><span>${esc(j.e)}</span><span>${esc(j.cat.join(", "))}</span><span>publ. ${fdate(j.p || j.first)}</span></div></li>`).join("")}</ol></section>` : ""}
      ${topW.length ? `<section><h2>Vinner oftast här</h2><div class="table-wrap"><table><tbody>${topW.map(([key, w]) => `<tr><td><a href="#/l/${encodeURIComponent(key)}">${esc(w.n)}</a></td><td class="n">${w.c} vinster</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      <section><h2>Öppna upphandlingar</h2>${rows(openN, "Inga öppna upphandlingar i TED just nu.")}</section>
      <section><h2>Senast avgjorda</h2>${rows(res.slice(0, 12), "Inga avgjorda upphandlingar i arkivet.")}</section>
      ${units.length > 1 ? `<section><h2>Köparenheter</h2><div class="chips">${units.map(b => `<a class="chip" href="#/k/${encodeURIComponent(b.k)}">${esc(b.n)}</a>`).join("")}</div></section>` : ""}
      <p class="note">Upphandlingar och rekryteringar kopplas via organisationens namn och kan i enstaka fall missa bolag eller förbund som kommunen äger.</p>`;
  }

  // ---------- bevakningar (lokala i webbläsaren + standard från watches.json) ----------
  function matchW(n, w) {
    const text = `${n.t} ${n.b || ""} ${n.ds || ""}`.toLowerCase();
    const terms = (w.terms || []).map(t => t.toLowerCase());
    const cpv = w.cpv || [];
    if (terms.length || cpv.length) {
      const th = terms.some(t => text.includes(t));
      const ch = cpv.length && (n.c || []).some(c => cpv.some(p => c.startsWith(p)));
      if (!th && !ch) return false;
    }
    if (w.lan && w.lan.length && !(n.l || []).some(l => w.lan.includes(l))) return false;
    return true;
  }
  async function allWatches() {
    const defs = await loadWatchDefaults();
    const hidden = store.get("hidden", []);
    const own = store.get("watches", []);
    return [...defs.map(w => ({ ...w, id: "d:" + w.name, def: true })), ...own].filter(w => !hidden.includes(w.id));
  }
  async function watchHits() {
    const open = await load("open");
    const seen = store.get("seen", {});
    return (await allWatches()).map(w => {
      const hits = open.filter(n => matchW(n, w));
      const last = seen[w.id] || "";
      return { w, hits, fresh: last ? hits.filter(n => (n.p || "") > last) : hits };
    });
  }

  async function viewWatch() {
    const meta = await load("meta");
    if (!meta) return noData();
    const hits = await watchHits();
    const hidden = store.get("hidden", []);
    const blocks = hits.map(({ w, hits, fresh }) => `
      <div class="watch">
        <div class="watch-head"><h3>${esc(w.name)} ${fresh.length ? `<span class="badge">${fresh.length} nya</span>` : ""}</h3>
          <span class="chips">
            <button class="chip" type="button" data-seen="${esc(w.id)}">Markera som sedda</button>
            <button class="chip" type="button" data-hide="${esc(w.id)}">${w.def ? "Dölj" : "Ta bort"}</button></span></div>
        <div class="note">${esc((w.terms || []).join(", "))}${w.cpv && w.cpv.length ? " · CPV " + esc(w.cpv.join(", ")) : ""}${w.lan && w.lan.length ? " · " + esc(w.lan.join(", ")) : ""}</div>
        ${hits.length ? `<details${fresh.length ? " open" : ""}><summary>${hits.length} ${hits.length === 1 ? "öppen träff" : "öppna träffar"}</summary>${rows((fresh.length ? fresh : hits).slice(0, 30), "")}</details>` : `<span class="note">Inga öppna träffar just nu.</span>`}
      </div>`).join("");
    return `<section><h1>Bevakning</h1>
      <p class="lead">Dina sökprofiler mot alla öppna upphandlingar. "Nya" betyder publicerade sedan du senast markerade dem som sedda. Mejl om nya träffar kommer som GitHub-notiser när Action-jobbet hittar något.</p></section>
      <section>${blocks || `<div class="empty">Inga bevakningar. Lägg till en nedan.</div>`}</section>
      <section><h2>Ny bevakning</h2>
        <form id="wform" class="filters">
          <input id="wname" name="name" placeholder="Namn, t.ex. Säkerhet Skåne" required aria-label="Namn">
          <input id="wterms" name="terms" placeholder="Sökord, kommaseparerade" aria-label="Sökord">
          <input id="wcpv" name="cpv" placeholder="CPV-prefix, t.ex. 7941, 72" aria-label="CPV-prefix">
          <select id="wlan" name="lan" aria-label="Län"><option value="">Alla län</option>${LAN.map(l => `<option>${esc(l)}</option>`).join("")}</select>
          <button class="btn" type="submit">Spara bevakning</button>
        </form>
        <p class="note">Egna bevakningar sparas i den här webbläsaren. För mejlnotiser, lägg dem också i filen watches.json i repot.</p>
        ${hidden.length ? `<p><button class="chip" type="button" id="unhide">Visa ${hidden.length} dolda standardbevakningar</button></p>` : ""}
      </section>`;
  }

  // ---------- router ----------
  function parse() {
    const h = location.hash.replace(/^#\/?/, "");
    const [path, qs] = h.split("?");
    return { parts: path.split("/").map(decodeURIComponent), params: new URLSearchParams(qs || "") };
  }
  async function render() {
    const { parts, params } = parse();
    const [a, b] = parts;
    document.querySelectorAll("nav.main a").forEach(el => {
      const map = { u: "sok", k: "kopare", l: "leverantorer" };
      el.toggleAttribute("aria-current", el.dataset.nav === (map[a] || a || ""));
      if (el.hasAttribute("aria-current")) el.setAttribute("aria-current", "page");
    });
    let html;
    try {
      if (!a) html = await viewHome();
      else if (a === "sok") html = await viewSearch(params);
      else if (a === "u" && b) html = await viewNotice(b);
      else if (a === "kopare") html = await viewBuyers(params);
      else if (a === "k" && b) html = await viewBuyer(b);
      else if (a === "leverantorer") html = await viewSuppliers(params);
      else if (a === "l" && b) html = await viewSupplier(b);
      else if (a === "bevakning") html = await viewWatch();
      else if (a === "signaler") html = await viewSignals(params);
      else if (a === "kort" && b) html = await viewCard(b);
      else if (a === "kort") html = await viewCards(params);
      else html = `<div class="empty">Sidan finns inte. <a href="#/">Till översikten</a></div>`;
    } catch (e) {
      console.error(e);
      html = `<div class="empty">Något gick fel när data lästes in: ${esc(e.message)}. Ladda om sidan.</div>`;
    }
    app.innerHTML = html;
    if (!/^(u|k|l)$/.test(a || "")) window.scrollTo(0, 0); else window.scrollTo(0, 0);
    bind(a);
    const meta = await load("meta");
    if (meta && meta.updatedAt) document.getElementById("upd").textContent =
      `Data från EU:s TED-databas. Senast uppdaterad ${new Date(meta.updatedAt).toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" })}, ${n0(meta.counts.notices)} annonser i arkivet.`;
  }
  function go(path, params) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => { if (v && v !== "0") qs.set(k, v); });
    const s = qs.toString();
    location.hash = "#/" + path + (s ? "?" + s : "");
  }
  function bind(a) {
    const sform = document.getElementById("sform");
    if (sform) sform.addEventListener("submit", e => { e.preventDefault(); go("sok", { q: document.getElementById("q").value.trim() }); });
    const filters = document.getElementById("filters");
    if (filters) {
      const apply = () => { const d = Object.fromEntries(new FormData(filters)); if (d.st === "open") delete d.st; if (d.sort === "pub") delete d.sort; go("sok", d); };
      filters.addEventListener("change", apply);
      filters.addEventListener("submit", e => { e.preventDefault(); apply(); });
    }
    const cardform = document.getElementById("cardform");
    if (cardform) {
      const apply = () => { const d = Object.fromEntries(new FormData(cardform)); if (d.lan === "Skåne län") delete d.lan; go("kort", d); };
      cardform.addEventListener("change", apply);
      cardform.addEventListener("submit", e => { e.preventDefault(); apply(); });
    }
    const sigform = document.getElementById("sigform");
    if (sigform) {
      const apply = () => { const d = Object.fromEntries(new FormData(sigform)); if (d.st === "open") delete d.st; go("signaler", d); };
      sigform.addEventListener("change", apply);
      sigform.addEventListener("submit", e => { e.preventDefault(); apply(); });
    }
    const lform = document.getElementById("lform");
    if (lform) lform.addEventListener("submit", e => { e.preventDefault(); go(a, { q: document.getElementById("lq").value.trim() }); });
    const wform = document.getElementById("wform");
    if (wform) wform.addEventListener("submit", e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(wform));
      const split = s => (s || "").split(",").map(x => x.trim()).filter(Boolean);
      const w = { id: "u:" + Date.now(), name: d.name.trim(), terms: split(d.terms), cpv: split(d.cpv), lan: d.lan ? [d.lan] : [] };
      if (!w.terms.length && !w.cpv.length && !w.lan.length) return;
      store.set("watches", [...store.get("watches", []), w]);
      render();
    });
    app.querySelectorAll("[data-seen]").forEach(el => el.addEventListener("click", () => {
      const seen = store.get("seen", {}); seen[el.dataset.seen] = today(); store.set("seen", seen); render();
    }));
    app.querySelectorAll("[data-hide]").forEach(el => el.addEventListener("click", () => {
      const id = el.dataset.hide;
      if (id.startsWith("u:")) store.set("watches", store.get("watches", []).filter(w => w.id !== id));
      else store.set("hidden", [...store.get("hidden", []), id]);
      render();
    }));
    const unhide = document.getElementById("unhide");
    if (unhide) unhide.addEventListener("click", () => { store.set("hidden", []); render(); });
  }

  // ---------- tema ----------
  const root = document.documentElement;
  const savedTheme = store.get("theme", null);
  if (savedTheme) root.dataset.theme = savedTheme;
  document.getElementById("theme").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    store.set("theme", root.dataset.theme);
  });

  window.addEventListener("hashchange", render);
  render();
})();
