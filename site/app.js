// Renders the seminar program from data/seminars.js (written daily from the Google Calendar
// by scripts/fetch-calendar.mjs). Which program is "current", "upcoming" or "previous" is
// decided here from today's date, so nothing needs to be moved when a term ends.

(function () {
  const $ = id => document.getElementById(id);
  const content = $('content');

  const data = window.SEMINAR_DATA;
  if (!data) {
    content.innerHTML = '<p class="empty">The program could not be loaded. Please try again later.</p>';
    return;
  }
  const settings = data.settings;

  const std = settings.standard;
  // ?today=2027-08-15 previews how the page will look on another date
  const today = new URL(location.href).searchParams.get('today')?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0]
    ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());
  // Placeholder slots ("TBA") that were never filled in are dropped once their date has passed.
  const seminars = data.seminars.filter(s => !(s.speakerTBA && s.date < today));

  // -------------------------------------------------------------------------
  // Helpers

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const termOf = date => `${date.slice(0, 4)}-${+date.slice(5, 7) <= 6 ? 'spring' : 'fall'}`;
  const termLabel = id => { const [y, t] = id.split('-'); return `${t === 'spring' ? 'Spring' : 'Fall'} ${y}`; };
  const listJoin = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthOf = date => MONTHS[+date.slice(5, 7) - 1];

  // A term's usual day and time is whatever most of its seminars use, so a permanent change
  // (say, to Mondays 11-12) needs no settings change: only the exceptions get a "Note" label.
  // settings.standard is the fallback for terms without a clear majority (or fewer than 3 seminars).
  function mostCommon(xs) {
    const counts = new Map();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
    return n >= 3 && n > xs.length / 2 ? best : null;
  }
  const norms = new Map();
  function normOf(term) {
    if (!norms.has(term)) {
      const list = seminars.filter(s => s.term === term && !s.cancelled && s.start);
      const time = mostCommon(list.map(s => `${s.start}–${s.end}`))?.split('–');
      norms.set(term, {
        weekday: mostCommon(list.map(s => s.weekday)) ?? std.weekday,
        start: time?.[0] ?? std.start,
        end: time?.[1] ?? std.end,
      });
    }
    return norms.get(term);
  }

  function deviations(s) {
    const norm = normOf(s.term);
    const out = [];
    if (s.weekday !== norm.weekday) out.push(s.weekday);
    if (s.start && (s.start !== norm.start || s.end !== norm.end)) out.push(`${s.start}–${s.end}`);
    return out;
  }

  // Search ignores case and accents ("merilainen" finds "Meriläinen"); fold() keeps an index
  // map so that matches can be highlighted in the original text.
  function fold(text) {
    let out = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
      const f = text[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      for (const ch of f) { out += ch; map.push(i); }
    }
    return { out, map };
  }
  let terms = [];
  function hl(text) {
    text = String(text ?? '');
    if (!terms.length) return esc(text);
    const { out, map } = fold(text);
    const marks = new Array(text.length).fill(false);
    for (const t of terms) {
      for (let i = out.indexOf(t); i >= 0; i = out.indexOf(t, i + 1)) {
        for (let k = i; k < i + t.length; k++) marks[map[k]] = true;
      }
    }
    let html = '', open = false;
    for (let i = 0; i < text.length; i++) {
      if (marks[i] !== open) { html += marks[i] ? '<mark>' : '</mark>'; open = marks[i]; }
      html += esc(text[i]);
    }
    return html + (open ? '</mark>' : '');
  }
  const haystack = s => fold([
    ...s.people.flatMap(p => [p.name, p.affiliation]), s.title, s.coauthors, termLabel(s.term),
  ].filter(Boolean).join(' · ')).out;

  // -------------------------------------------------------------------------
  // Rendering

  function people(s) {
    if (s.speakerTBA) return '<span class="who"><span class="name tba">Speaker TBA</span></span>';
    const affs = [...new Set(s.people.map(p => p.affiliation))];
    if (affs.length === 1) {
      return `<span class="who"><span class="name">${hl(listJoin(s.people.map(p => p.name)))}</span>` +
        (affs[0] ? `<span class="aff">${hl(affs[0])}</span>` : '') + '</span>';
    }
    return s.people.map(p => `<span class="who"><span class="name">${hl(p.name)}</span>` +
      (p.affiliation ? `<span class="aff">${hl(p.affiliation)}</span>` : '') + '</span>').join('');
  }

  function seminarItem(s, { showDeviations = true, next = null } = {}) {
    const isPast = s.date < today;
    const badges = [];
    if (s.cancelled) badges.push('<span class="badge cancelled">Cancelled</span>');
    if (s === next) badges.push(`<span class="badge next">${s.date === today ? 'Today' : 'Next seminar'}</span>`);
    if (showDeviations && !s.cancelled) {
      const dev = deviations(s);
      if (dev.length) badges.push(`<span class="badge deviation">Note: ${esc(dev.join(', '))}</span>`);
      if (s.room) badges.push(`<span class="badge deviation">Room: ${esc(s.room)}</span>`);
    }
    if (s.online) badges.push('<span class="badge">Online</span>');
    if (s.joint) badges.push(`<span class="badge joint">Joint with the ${esc(settings.jointSeminarName)}</span>`);

    const title = s.title
      ? `<p class="title">${hl(s.title)}</p>`
      : (s.speakerTBA || isPast ? '' : '<p class="title tba">Title TBA</p>');

    return `<li class="seminar${isPast ? ' past' : ''}${s.cancelled ? ' is-cancelled' : ''}${s === next ? ' is-next' : ''}">
      <time class="when" datetime="${s.date}${s.start ? `T${s.start}` : ''}">
        <span class="dow">${esc(s.weekday.slice(0, 3))}</span>
        <span class="day">${+s.date.slice(8)}</span>
        <span class="mon">${monthOf(s.date)}</span>
      </time>
      <div class="what">
        <p class="people">${people(s)}</p>
        ${title}
        ${s.coauthors ? `<p class="coauthors">with ${hl(s.coauthors)}</p>` : ''}
        ${s.notes.length ? `<p class="notes">${s.notes.map(esc).join('<br>')}</p>` : ''}
        ${badges.length ? `<p class="badges">${badges.join('')}</p>` : ''}
      </div>
    </li>`;
  }

  const byTerm = new Map();
  for (const s of seminars) {
    if (!byTerm.has(s.term)) byTerm.set(s.term, []);
    byTerm.get(s.term).push(s);
  }
  // "2026-spring" -> "2026-1", "2026-fall" -> "2026-2", so terms sort chronologically
  const termKey = id => id.replace('spring', '1').replace('fall', '2');
  const termIds = [...byTerm.keys()].sort((a, b) => termKey(a).localeCompare(termKey(b)));
  const nowTerm = termOf(today);
  const future = termIds.filter(t => termKey(t) > termKey(nowTerm));
  const mainTerm = byTerm.has(nowTerm) ? nowTerm : future[0];
  const upcomingTerms = future.filter(t => t !== mainTerm);
  const previousTerms = termIds.filter(t => termKey(t) < termKey(nowTerm)).reverse();
  const nextSeminar = seminars.find(s => s.date >= today && !s.cancelled);

  function termList(id, opts) {
    return `<ol class="seminars">${byTerm.get(id).map(s => seminarItem(s, opts)).join('')}</ol>`;
  }

  function allTBA(id) { return byTerm.get(id).every(s => s.speakerTBA); }

  function renderProgram() {
    let html = '';

    if (mainTerm) {
      const heading = mainTerm === nowTerm ? 'Current program' : 'Upcoming program';
      html += `<section class="term-section" id="${mainTerm}">
        <h2><span class="kicker">${heading}</span>${termLabel(mainTerm)}</h2>
        ${mainTerm !== nowTerm ? `<p class="empty">The program for ${termLabel(nowTerm)} has not been posted.</p>` : ''}
        ${allTBA(mainTerm) ? '<p class="lead">Dates are set. Speakers will be announced.</p>' : ''}
        ${termList(mainTerm, { next: nextSeminar })}
      </section>`;
    } else {
      html += `<section class="term-section"><h2><span class="kicker">Current program</span>${termLabel(nowTerm)}</h2>
        <p class="empty">The program for ${termLabel(nowTerm)} will be posted soon.</p></section>`;
    }

    for (const id of upcomingTerms) {
      html += `<section class="term-section" id="${id}">
        <h2><span class="kicker">Upcoming program</span>${termLabel(id)}</h2>
        ${allTBA(id) ? '<p class="lead">Dates are set. Speakers will be announced.</p>' : ''}
        ${termList(id, { next: nextSeminar })}
      </section>`;
    }

    if (previousTerms.length) {
      html += `<section class="term-section previous" id="previous">
        <h2><span class="kicker">Archive</span>Previous programs</h2>
        ${previousTerms.map(id => `<details class="term" id="${id}">
            <summary><span class="term-name">${termLabel(id)}</span></summary>
            ${termList(id, { showDeviations: false })}
          </details>`).join('')}
      </section>`;
    }
    content.innerHTML = html;
  }

  // The box at the top: the first upcoming seminar (today's counts), or TBA if none is scheduled.
  function renderNext() {
    const s = nextSeminar;
    if (!s) {
      $('next').innerHTML = `<p class="kicker">Next seminar</p>
        <p class="next-who"><span class="name tba">TBA</span></p>
        <p class="next-meta">The next seminar will be announced soon.</p>`;
      return;
    }
    const day = new Date(`${s.date}T12:00:00Z`).toLocaleDateString('en-GB', {
      timeZone: 'UTC', day: 'numeric', month: 'long',
      ...(s.date.slice(0, 4) !== today.slice(0, 4) && { year: 'numeric' }),
    });
    const when = [`${s.weekday} ${day}`, s.start && `${s.start}–${s.end}`, s.online ? 'Online' : `Room ${s.room ?? std.room}`];
    const badges = s.joint ? `<p class="badges"><span class="badge joint">Joint with the ${esc(settings.jointSeminarName)}</span></p>` : '';
    $('next').innerHTML = `<p class="kicker">${s.date === today ? 'Today' : 'Next seminar'}</p>
      <p class="next-when">${when.filter(Boolean).map(esc).join(' · ')}</p>
      <p class="next-who">${people(s)}</p>
      ${s.title ? `<p class="next-title">${esc(s.title)}</p>` : (s.speakerTBA ? '' : '<p class="next-title tba">Title TBA</p>')}
      ${s.coauthors ? `<p class="coauthors">with ${esc(s.coauthors)}</p>` : ''}
      ${s.notes.length ? `<p class="notes">${s.notes.map(esc).join('<br>')}</p>` : ''}
      ${badges}`;
  }

  function renderSearch(query) {
    const results = seminars.filter(s => terms.every(t => haystack(s).includes(t)));
    $('search-status').textContent = results.length
      ? `${results.length} seminar${results.length === 1 ? '' : 's'} matching “${query}”`
      : `No seminars match “${query}”.`;
    const groups = new Map();
    for (const s of results.slice().reverse()) {
      if (!groups.has(s.term)) groups.set(s.term, []);
      groups.get(s.term).push(s);
    }
    content.innerHTML = [...groups].map(([id, list]) => `<section class="term-section results">
        <h3>${termLabel(id)}</h3>
        <ol class="seminars">${list.reverse().map(s => seminarItem(s, { showDeviations: false })).join('')}</ol>
      </section>`).join('');
  }

  function update() {
    const query = $('q').value.trim();
    terms = fold(query).out.split(/\s+/).filter(Boolean);
    const url = new URL(location.href);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
    $('next').hidden = terms.length > 0;
    if (terms.length) renderSearch(query);
    else { $('search-status').textContent = ''; renderProgram(); }
  }

  function openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const el = id && document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'DETAILS') el.open = true;
    el.scrollIntoView({ block: 'start' });
  }

  // -------------------------------------------------------------------------
  // Page chrome from settings.json

  $('name').textContent = settings.name;
  $('affiliation').textContent = `${settings.department} · ${settings.university}`;
  // Texts in settings.json may contain links written as [text](https://...)
  const withLinks = text => esc(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const usual = normOf(mainTerm ?? nowTerm);
  $('practical').innerHTML =
    `<span>${esc(usual.weekday)}s ${esc(usual.start)}–${esc(usual.end)}</span>` +
    `<span>Room ${esc(std.room)}</span>` +
    `<span>Organized by ${withLinks(listJoin(settings.organizers))}</span>`;
  $('about').innerHTML = withLinks(settings.about);

  // One button per calendar app: a webcal:// link opens whatever the computer's default calendar
  // app is (Apple Calendar on a Mac, even with Outlook installed), so Outlook gets its own
  // "subscribe from web" link, and "Copy link" works with any other app.
  const cid = settings.calendarId;
  const icsUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(cid)}/public/basic.ics`;
  $('subscribe').innerHTML =
    '<span class="subscribe-label">Add to your calendar:</span>' +
    `<a class="button" href="https://calendar.google.com/calendar/u/0?cid=${encodeURIComponent(btoa(cid))}" target="_blank" rel="noopener">Google Calendar</a>` +
    `<a class="button" href="https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(icsUrl)}&name=${encodeURIComponent(settings.name)}" target="_blank" rel="noopener">Outlook</a>` +
    `<a class="button" href="${icsUrl.replace(/^https:/, 'webcal:')}">Apple Calendar</a>` +
    '<button type="button" class="button secondary" id="copy-link">Copy calendar link</button>';

  $('copy-link').addEventListener('click', async e => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(icsUrl);
    } catch {
      // Clipboard API unavailable (e.g. page opened from disk): fall back to a hidden text field
      const field = Object.assign(document.createElement('textarea'), { value: icsUrl });
      document.body.append(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    btn.textContent = 'Link copied';
    setTimeout(() => { btn.textContent = 'Copy calendar link'; }, 2500);
  });

  const updated = new Date(data.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  $('footer').innerHTML =
    `<p>Contact: <a href="mailto:${esc(settings.contact)}">${esc(settings.contact)}</a></p>` +
    `<p>Program last updated ${esc(updated)}.</p>`;

  // -------------------------------------------------------------------------

  const initial = new URL(location.href).searchParams.get('q');
  if (initial) $('q').value = initial;
  $('q').addEventListener('input', update);
  window.addEventListener('hashchange', () => { if ($('q').value) { $('q').value = ''; update(); } openFromHash(); });
  renderNext();
  update();
  openFromHash();
})();
