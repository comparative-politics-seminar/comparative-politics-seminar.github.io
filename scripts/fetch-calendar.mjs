// Reads the seminar series' public Google Calendar and writes site/data/seminars.js (the program
// plus site/settings.json), which the web page displays. Runs daily via GitHub Actions; can also be run by hand:
//
//   node scripts/fetch-calendar.mjs                  fetch the calendar and update the data
//   node scripts/fetch-calendar.mjs --file cal.ics   read a downloaded calendar file instead
//   node scripts/fetch-calendar.mjs --report         also print how every event was interpreted
//   node scripts/fetch-calendar.mjs --dry-run        do not write anything
//
// Conventions for calendar events (see README.md):
//   Event title:   Name (Affiliation)       e.g. "Edmund Kelly (University of Oxford)"
//   Description:   Title: ...  /  Co-authors: ...  /  Note: ...   (one per line, all optional)
//   "CANCELLED" in the event title, "Joint with the Higher Research Seminar" (or "JOINT WITH AS")
//   and "Online" are shown as labels.
//   Location:      only needed if it differs from the standard room

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settings = JSON.parse(await readFile(path.join(root, 'site/settings.json'), 'utf8'));
const outFile = path.join(root, 'site/data/seminars.js');
const TZ = 'Europe/Stockholm';
const DAY = 86400000;

// ---------------------------------------------------------------------------
// iCalendar parsing
// ---------------------------------------------------------------------------

function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') { events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const [, name, paramStr, value] = m;
    const params = Object.fromEntries(
      paramStr.split(';').filter(Boolean).map(p => p.split('=').map(s => s.replace(/^"|"$/g, '')))
    );
    if (name === 'EXDATE') {
      (ev.EXDATE ??= []).push(...value.split(',').map(v => ({ value: v, params })));
    } else {
      ev[name] = { value, params };
    }
  }
  return events;
}

const unescapeText = v => (v ?? '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

// Local wall-clock parts of an instant in Stockholm time.
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long', hourCycle: 'h23',
});
function localParts(ms) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, weekday: p.weekday };
}

// Instant for a wall-clock time in Stockholm (handles daylight saving time).
function zonedToMs(y, mo, d, h = 0, mi = 0, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const p = localParts(ms);
    const offset = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - ms;
    ms = guess - offset;
  }
  return ms;
}

function parseDate(prop) {
  const m = prop.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) throw new Error(`Unrecognised date: ${prop.value}`);
  const [, y, mo, d, h, mi, s, z] = m.map((x, i) => (i > 0 && i < 7 && x !== undefined ? +x : x));
  if (h === undefined) return { ms: zonedToMs(y, mo, d), allDay: true };
  if (z) return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false };
  return { ms: zonedToMs(y, mo, d, h, mi, s), allDay: false }; // TZID assumed to be Stockholm
}

// ---------------------------------------------------------------------------
// Recurring events (Google uses these for placeholder "TBA" slots)
// ---------------------------------------------------------------------------

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function expandRecurrence(ev, start, durationMs, warnings) {
  const rule = Object.fromEntries(ev.RRULE.value.split(';').map(p => p.split('=')));
  const interval = +(rule.INTERVAL ?? 1);
  const count = rule.COUNT ? +rule.COUNT : Infinity;
  const until = rule.UNTIL ? parseDate({ value: rule.UNTIL }).ms : Date.now() + 2 * 365 * DAY;
  const p = localParts(start.ms);
  // Work on local calendar dates (days since epoch) so the wall-clock time survives DST changes.
  const startDay = Date.UTC(p.y, p.mo - 1, p.d) / DAY;
  const at = day => {
    const d = new Date(day * DAY);
    return zonedToMs(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), p.h, p.mi, p.s);
  };

  let days = [];
  if (rule.FREQ === 'DAILY') {
    for (let day = startDay; days.length < 500; day += interval) days.push(day);
  } else if (rule.FREQ === 'WEEKLY') {
    const isoDow = day => (new Date(day * DAY).getUTCDay() + 6) % 7; // Monday = 0
    const wkst = WEEKDAYS.indexOf(rule.WKST ?? 'MO');
    const byday = (rule.BYDAY ? rule.BYDAY.split(',') : [WEEKDAYS[isoDow(startDay)]])
      .map(x => WEEKDAYS.indexOf(x.slice(-2)));
    const weekStart = startDay - ((isoDow(startDay) - wkst + 7) % 7);
    for (let w = weekStart; days.length < 500 && at(w) <= until; w += 7 * interval) {
      for (const dow of byday) {
        const day = w + ((dow - wkst + 7) % 7);
        if (day >= startDay) days.push(day);
      }
    }
    days.sort((a, b) => a - b);
  } else {
    warnings.push(`Unsupported repeat rule "${ev.RRULE.value}" for "${unescapeText(ev.SUMMARY?.value)}"; only the first date is shown.`);
    return [{ ms: start.ms, end: start.ms + durationMs }];
  }

  const excluded = new Set((ev.EXDATE ?? []).map(x => parseDate(x).ms));
  return days.map(at).filter(ms => ms <= until).slice(0, count)
    .filter(ms => !excluded.has(ms))
    .map(ms => ({ ms, end: ms + durationMs, recurrenceKey: ms }));
}

function eventInstances(events, warnings) {
  // Single occurrences edited inside a recurring series carry RECURRENCE-ID.
  const overrides = new Map();
  for (const ev of events) {
    if (ev['RECURRENCE-ID']) overrides.set(`${ev.UID.value}|${parseDate(ev['RECURRENCE-ID']).ms}`, ev);
  }
  const out = [];
  for (const ev of events) {
    if (ev['RECURRENCE-ID'] || !ev.DTSTART) continue;
    const start = parseDate(ev.DTSTART);
    const end = ev.DTEND ? parseDate(ev.DTEND).ms : start.ms + 3600000;
    const occurrences = ev.RRULE
      ? expandRecurrence(ev, start, end - start.ms, warnings)
      : [{ ms: start.ms, end }];
    for (const occ of occurrences) {
      const override = occ.recurrenceKey !== undefined && overrides.get(`${ev.UID.value}|${occ.recurrenceKey}`);
      if (override) {
        const s = parseDate(override.DTSTART);
        out.push({ ev: override, ms: s.ms, end: override.DTEND ? parseDate(override.DTEND).ms : s.ms + 3600000, allDay: s.allDay });
      } else {
        out.push({ ev, ms: occ.ms, end: occ.end, allDay: start.allDay });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Interpreting the text of an event
// ---------------------------------------------------------------------------

function cleanText(v) {
  return unescapeText(v)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const TBA = /^(tba|tbd|tbc|title tba|title tbd|to be announced|to be decided)\.?$/i;
const JOINT = /\(?\s*=?\s*joint\s+with\b[^)\n]*\)?/i;
const ONLINE = /\b(on zoom( only)?|via zoom|zoom|online( only)?)\b/i;
const CANCELLED = /\*?\s*\b(cancell?ed|inställt)\b\s*\*?/i;
const DOUBLE_QUOTES = /["“”„«»]/;

function expandAffiliation(aff) {
  return aff.split(/\s*\/\s*/).map(part => settings.affiliations[part] ?? part).join(' / ');
}

// "Ann A, Bo B & Cy C (SU), Dan D (UU)" -> [{name:"Ann A, Bo B & Cy C", affiliation:"Stockholm University"}, ...]
function parsePeople(text) {
  const people = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '(') { buf += text[i]; continue; }
    let depth = 0, j = i;
    for (; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')' && --depth === 0) break;
    }
    const inner = text.slice(i + 1, j).trim();
    const name = buf.replace(/^[\s,;&:]+|^and\s+/i, '').trim();
    buf = '';
    i = j;
    if (name) people.push({ name, affiliation: expandAffiliation(inner) });
  }
  const rest = buf.replace(/^[\s,;:–-]+/, '').trim();
  return { people, rest };
}

// Co-authors written like "(& Dylan Pashley)", "(w. A, B & C)" or "(with Almut S-V)".
function coauthorsIn(text) {
  const m = text.match(/\(\s*(?:&|w\.|with|and)\s*([^)]+)\)/i);
  return m ? m[1].trim() : null;
}

const LABELLED = /^(title|titel|co-?authors?|with|note|notes)\s*:\s*(.*)$/i;
const ONLINE_NOTE = /^(online|online only|on zoom|zoom|online \(zoom\))\.?$/i;
const unquote = s => s.trim().replace(/^["“”„«»]+|["“”„«»]+$/g, '').trim();

function parseDescription(desc) {
  const lines = cleanText(desc).split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { title: null, coauthors: null, notes: [] };

  // Standard format:  "Title: ...", "Co-authors: ...", "Note: ..." (any order, all optional)
  if (lines.some(l => LABELLED.test(l))) {
    let title = null, coauthors = null;
    const notes = [];
    for (const line of lines) {
      const m = line.match(LABELLED);
      const label = m?.[1].toLowerCase();
      if (label === 'title' || label === 'titel') title = unquote(m[2]) || null;
      else if (label && label !== 'note' && label !== 'notes') coauthors = m[2].trim() || null;
      else if (m) { if (m[2].trim()) notes.push(m[2].trim()); }
      else notes.push(line);
    }
    if (title && TBA.test(title)) title = null;
    return { title, coauthors, notes };
  }

  // Older free-form descriptions: the title is on the first line, possibly after "Name (Aff):"
  const [first, ...rest] = lines;
  let title, coauthors = null;
  const q1 = first.search(DOUBLE_QUOTES);
  const q2 = Math.max(...[...first.matchAll(/["“”„«»]/g)].map(m => m.index));
  if (q1 >= 0 && q2 > q1) {
    // e.g.  Moa Frödin Gruneau (GU): “A social theory of economic voting”
    title = first.slice(q1 + 1, q2).trim();
    coauthors = coauthorsIn(first.slice(0, q1)) ?? coauthorsIn(first.slice(q2 + 1));
  } else {
    // e.g.  Cornelia Leander (SU), TBA   -> strip a leading "Name (Aff)," prefix
    title = first.replace(/^[^()"“”]+\([^()]*\)\s*[,:–-]\s*/, '').trim();
  }
  if (!title || TBA.test(title)) title = null;
  return { title, coauthors, notes: rest };
}

function interpret({ ev, ms, end, allDay }) {
  let summary = cleanText(ev.SUMMARY?.value);
  const location = cleanText(ev.LOCATION?.value);
  const desc = parseDescription(ev.DESCRIPTION?.value);
  const all = [summary, location, ...desc.notes].join('\n');

  const cancelled = ev.STATUS?.value === 'CANCELLED' || CANCELLED.test(summary);
  const joint = JOINT.test(all) || JOINT.test(ev.DESCRIPTION ? cleanText(ev.DESCRIPTION.value) : '');
  const online = ONLINE.test(summary) || ONLINE.test(location) || desc.notes.some(n => ONLINE_NOTE.test(n));
  summary = summary.replace(CANCELLED, ' ').replace(JOINT, ' ')
    .replace(/[,;]?\s*\b(on zoom only|on zoom|via zoom|online only|online)\b/i, ' ')
    .replace(/\s+/g, ' ').trim();

  const { people, rest } = parsePeople(summary);
  let speakerTBA = false;
  let title = desc.title;
  if (!people.length) {
    if (!rest || TBA.test(rest)) speakerTBA = true;
    else people.push({ name: rest, affiliation: null });
  } else if (rest && !title && !TBA.test(rest)) {
    title = rest; // title written in the event title, after the affiliation
  }

  let room = location.replace(JOINT, '').replace(/\b(online only|online|on zoom|via zoom|zoom)\b/gi, '')
    .replace(/\(\s*\)/g, '').replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '').trim();
  if (!room || room.toLowerCase() === settings.standard.room.toLowerCase()) room = null;

  const s = localParts(ms);
  const e = localParts(end);
  const hhmm = p => `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
  const date = `${s.y}-${String(s.mo).padStart(2, '0')}-${String(s.d).padStart(2, '0')}`;

  return {
    id: `${ev.UID?.value ?? 'event'}-${date}`,
    date,
    weekday: s.weekday,
    start: allDay ? null : hhmm(s),
    end: allDay ? null : hhmm(e),
    term: `${s.y}-${s.mo <= 6 ? 'spring' : 'fall'}`,
    people,
    speakerTBA,
    title,
    coauthors: desc.coauthors,
    cancelled,
    joint,
    online,
    room,
    // Joint/online notes are shown as labels instead
    notes: desc.notes.filter(n => !JOINT.test(n) && !ONLINE_NOTE.test(n)),
  };
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const icsUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(settings.calendarId)}/public/basic.ics`;

let ics;
if (fileArg) {
  ics = await readFile(fileArg, 'utf8');
} else {
  const res = await fetch(icsUrl);
  if (!res.ok) throw new Error(`Could not fetch the calendar (HTTP ${res.status}). Is it still public?`);
  ics = await res.text();
}
if (!ics.includes('BEGIN:VCALENDAR')) throw new Error('The calendar download does not look like a calendar.');

const warnings = [];
const seminars = eventInstances(parseICS(ics), warnings)
  .map(interpret)
  .sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')));

if (seminars.length === 0) throw new Error('The calendar contains no events; refusing to overwrite the program.');

// Written as a script (not JSON) so the page also works when index.html is opened straight from disk.
const PREFIX = 'window.SEMINAR_DATA = ';
let previous = null;
try { previous = JSON.parse((await readFile(outFile, 'utf8')).slice(PREFIX.length).replace(/;\s*$/, '')); } catch { /* first run */ }
const changed = JSON.stringify([previous?.settings, previous?.seminars]) !== JSON.stringify([settings, seminars]);

const dryRun = args.includes('--dry-run');
if (changed && !dryRun) {
  await mkdir(path.dirname(outFile), { recursive: true });
  const data = { updated: new Date().toISOString(), settings, seminars };
  await writeFile(outFile, `${PREFIX}${JSON.stringify(data, null, 2)};\n`);
}

if (args.includes('--report')) {
  for (const s of seminars) {
    const who = s.speakerTBA ? 'Speaker TBA' : s.people.map(p => `${p.name}${p.affiliation ? ` [${p.affiliation}]` : ''}`).join(' + ');
    const flags = [s.cancelled && 'CANCELLED', s.joint && 'JOINT', s.online && 'ONLINE', s.room && `room ${s.room}`].filter(Boolean);
    console.log(`${s.date} ${s.weekday.slice(0, 3)} ${s.start ?? 'all day'}  ${who}`);
    console.log(`            ${s.title ? `“${s.title}”` : '(title TBA)'}${s.coauthors ? `  with ${s.coauthors}` : ''}${flags.length ? `  {${flags.join(', ')}}` : ''}${s.notes.length ? `  notes: ${s.notes.join(' | ')}` : ''}`);
  }
}
for (const w of warnings) console.warn(`Warning: ${w}`);
console.log(`${seminars.length} seminars read; ${changed ? (dryRun ? 'program would change (dry run, nothing written)' : 'program updated') : 'no changes'}.`);
