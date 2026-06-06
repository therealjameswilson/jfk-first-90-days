import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_CORPUS_DIR =
  '/Users/jameswilson/research/jfk-1961-chronology/jfk/jfk_files_md';
const CORPUS_DIR = process.env.JFK_CORPUS_DIR || DEFAULT_CORPUS_DIR;
const OUTPUT_DIR =
  process.env.EISENHOWER_OUTPUT_DIR ||
  path.join(REPO_ROOT, 'public', 'eisenhower-chronology');

const START_DATE = '1953-01-20';
const END_DATE = '1961-01-19';
const PFIAB_END_DATE = '1960-12-31';
const PFIAB_SECTION_DIR = 'pfiab';
const RELEASE_URL = 'https://www.archives.gov/research/jfk/release-2025';
const SOURCE_BASE_URL = 'https://github.com/doctly/jfk/blob/main/jfk_files_md';
const CONTEXT_CHARS = 300;
const MAX_RANGE_DAYS = 31;

const monthPattern =
  'Jan(?:uary|\\.)?|Feb(?:ruary|\\.)?|Mar(?:ch|\\.)?|Apr(?:il|\\.)?|May|Jun(?:e|\\.)?|Jul(?:y|\\.)?|Aug(?:ust|\\.)?|Sep(?:t\\.?|tember|\\.)?|Oct(?:ober|\\.)?|Nov(?:ember|\\.)?|Dec(?:ember|\\.?)';
const scopeYearPattern = '(?:19(?:5[3-9]|60)|1961|(?:5[3-9]|60|61))';
const anyYearPattern = '(?:18\\d{2}|19\\d{2}|20\\d{2}|\\d{2})';

const keyEvents = new Map([
  ['1953-01-20', 'Eisenhower inaugurated'],
  ['1953-06-19', 'Rosenbergs executed'],
  ['1953-07-26', 'Moncada Barracks attack'],
  ['1953-08-19', 'Iran coup'],
  ['1954-05-07', 'Dien Bien Phu falls'],
  ['1954-06-18', 'Guatemala coup begins'],
  ['1954-07-21', 'Geneva Accords on Indochina'],
  ['1955-05-14', 'Warsaw Pact signed'],
  ['1956-10-29', 'Suez crisis begins'],
  ['1956-11-04', 'Soviet invasion of Hungary'],
  ['1957-10-04', 'Sputnik launched'],
  ['1958-05-13', 'Nixon attacked in Caracas'],
  ['1959-01-01', 'Batista flees Cuba'],
  ['1959-01-08', 'Castro enters Havana'],
  ['1959-04-15', 'Castro visits the United States'],
  ['1960-03-17', 'Eisenhower approves anti-Castro covert action'],
  ['1960-05-01', 'U-2 shot down over Soviet Union'],
  ['1960-07-13', 'Kennedy nominated for president'],
  ['1960-09-26', 'First Kennedy-Nixon debate'],
  ['1960-11-08', 'Kennedy elected president'],
  ['1961-01-03', 'United States breaks relations with Cuba'],
  ['1961-01-19', 'Last full day of Eisenhower administration'],
]);

const agencyByPrefix = new Map([
  ['104', 'CIA'],
  ['119', 'FBI'],
  ['124', 'CIA'],
  ['157', 'SSCIA'],
  ['176', 'CIA'],
  ['177', 'CIA'],
  ['178', 'CIA'],
  ['179', 'CIA'],
  ['180', 'HSCA'],
  ['197', 'NSA'],
  ['198', 'ARMY'],
  ['202', 'STATE'],
]);

function html(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attr(value) {
  return html(value).replace(/'/g, '&#39;');
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeForMatching(value) {
  return String(value || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/([Il])(?=9[5-6][0-9])/g, '1')
    .replace(/19([56])O/g, '19$10')
    .replace(/196[lI]/g, '1961')
    .replace(/l96([01])/g, '196$1')
    .replace(/l95([3-9])/g, '195$1');
}

function monthNumber(value) {
  const token = String(value || '').toLowerCase().replace(/\./g, '').slice(0, 3);
  return {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  }[token];
}

function normalizeYear(value) {
  const raw = String(value || '')
    .replace(/[oO]/g, '0')
    .replace(/[lI]/g, '1')
    .trim();
  if (!raw) return null;
  if (raw.length === 2) {
    const numeric = Number(raw);
    if (numeric <= 30) return 2000 + numeric;
    return 1900 + numeric;
  }
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function isoDate(year, month, day) {
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function isInScope(iso) {
  return iso && iso >= START_DATE && iso <= END_DATE;
}

function compareIso(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function formatDate(iso, options = {}) {
  if (!iso) return 'Unknown date';
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    month: options.short ? 'short' : 'long',
    day: 'numeric',
    year: options.noYear ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function weekdayName(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(date);
}

function monthName(month, short = false) {
  return new Intl.DateTimeFormat('en-US', {
    month: short ? 'short' : 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, month - 1, 1)));
}

function dayOrdinal(startIso, iso) {
  const start = new Date(`${startIso}T00:00:00Z`);
  const date = new Date(`${iso}T00:00:00Z`);
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000) + 1;
}

function eachDay(startIso = START_DATE, endIso = END_DATE) {
  const days = [];
  const date = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  while (date <= end) {
    days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

function datesBetween(startIso, endIso, maxDays = MAX_RANGE_DAYS) {
  if (!startIso || !endIso) return [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (end < start) return [];
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > maxDays) return [];
  const values = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    if (isInScope(iso)) values.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return values;
}

function parseAnyDate(value) {
  const text = normalizeForMatching(value);
  const monthDay = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(${anyYearPattern})\\b`,
    'i',
  ).exec(text);
  if (monthDay) {
    return isoDate(
      normalizeYear(monthDay[3]),
      monthNumber(monthDay[1]),
      Number(monthDay[2]),
    );
  }

  const dayMonth = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})(?:,)?\\s+(${anyYearPattern})\\b`,
    'i',
  ).exec(text);
  if (dayMonth) {
    return isoDate(
      normalizeYear(dayMonth[3]),
      monthNumber(dayMonth[2]),
      Number(dayMonth[1]),
    );
  }

  const numeric = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})\b/.exec(text);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = normalizeYear(numeric[3]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return isoDate(year, month, day);
  }

  const iso = /\b(18\d{2}|19\d{2}|20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  return null;
}

function sourceUrl(relPath) {
  return `${SOURCE_BASE_URL}/${relPath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

function lineField(lines, fieldName) {
  const expression = new RegExp(`^\\s*${fieldName}\\s*:\\s*(.+?)\\s*$`, 'i');
  const found = lines.find((line) => expression.test(line));
  return found ? normalizeSpaces(found.match(expression)?.[1] || '') : '';
}

function lineFieldWithContinuation(lines, fieldName, maxContinuationLines = 8) {
  const expression = new RegExp(`^\\s*${fieldName}\\s*:\\s*(.*?)\\s*$`, 'i');
  const index = lines.findIndex((line) => expression.test(line));
  if (index === -1) return '';

  const first = normalizeSpaces(lines[index].match(expression)?.[1] || '');
  const values = first ? [first] : [];
  for (let offset = 1; offset <= maxContinuationLines && index + offset < lines.length; offset += 1) {
    const line = normalizeSpaces(lines[index + offset]);
    if (!line) {
      if (values.length) break;
      continue;
    }
    if (/^[A-Z][A-Z0-9 /().,'"-]{1,60}\s*:/i.test(line)) break;
    if (/^(Agency Information|Document Information|NW\s|[-]{3,}|Page\s+\d+)/i.test(line)) break;
    values.push(line);
    if (values.join(' ').length > 300) break;
  }
  return normalizeSpaces(values.join(' '));
}

function parseCableDate(text) {
  const match = new RegExp(`\\b(\\d{2})(\\d{2})(?:\\d{2})?Z\\s+(${monthPattern})\\s+(\\d{2})\\b`, 'i').exec(
    normalizeForMatching(text.slice(0, 1600)),
  );
  if (!match) return null;
  return isoDate(normalizeYear(match[4]), monthNumber(match[3]), Number(match[1]));
}

function parseMetadata(rawText, relPath) {
  const text = normalizeForMatching(rawText);
  const lines = text.split(/\r?\n/).slice(0, 180);
  const filename = path.basename(relPath, '.md');
  const prefix = relPath.split(path.sep)[0]?.split('-')[0] || '';
  const recordNumber = lineField(lines, 'RECORD NUMBER') || filename.replace(/(?:_multirif.*| \\(.+\\))$/i, '');
  const originator = lineField(lines, 'ORIGINATOR');
  const title = lineField(lines, 'TITLE');
  const pfiabTitle = lineFieldWithContinuation(lines, 'TITLE', 4);
  const pfiabSubjects = lineFieldWithContinuation(lines, 'SUBJECTS');
  const pfiabSubject = lineFieldWithContinuation(lines, 'SUBJECT');
  const pfiabDescriptor = [
    originator,
    pfiabTitle,
    pfiabSubjects,
    pfiabSubject,
  ].join(' ');
  const agency =
    lineField(lines, 'AGENCY') ||
    originator ||
    agencyByPrefix.get(prefix) ||
    prefix ||
    'Unknown agency';
  const classification = lineField(lines, 'CLASSIFICATION');
  const subject =
    lineField(lines, 'SUBJECTS') ||
    lineField(lines, 'SUBJECT') ||
    lineField(lines, 'TITLE') ||
    recordNumber;
  const documentInfoIndex = lines.findIndex((line) => /^Document Information\s*$/i.test(line.trim()));
  const dateSearchLines =
    documentInfoIndex === -1 ? lines : lines.slice(documentInfoIndex + 1, documentInfoIndex + 80);
  const dateLine = dateSearchLines.find(
    (line) =>
      /^\s*DATE\s*:/i.test(line) &&
      !/LAST REVIEW|REVIEWED|RETURNED|RECEIVED|BIRTH|GRADE|LEAVE/i.test(line),
  );
  const dateValue = dateLine ? normalizeSpaces(dateLine.replace(/^\s*DATE\s*:/i, '')) : '';
  const rifDate =
    dateValue && !/^0{1,2}[/-]0{1,2}[/-]0{2,4}/.test(dateValue)
      ? parseAnyDate(dateValue)
      : null;
  const docDate = rifDate || parseCableDate(text);

  return {
    agency: agency.toUpperCase(),
    classification,
    docDate,
    displayTitle: pfiabTitle || pfiabSubject || pfiabSubjects || subject,
    originator,
    pfiabDescriptor,
    recordNumber,
    relPath,
    sourceName: path.basename(relPath),
    subject,
    title,
    url: sourceUrl(relPath),
  };
}

function paragraphBounds(text, index) {
  const beforeBreak = text.lastIndexOf('\n\n', index);
  const afterBreak = text.indexOf('\n\n', index);
  return {
    start: beforeBreak === -1 ? 0 : beforeBreak + 2,
    end: afterBreak === -1 ? text.length : afterBreak,
  };
}

function nearbyContext(text, start, end) {
  let contextStart = Math.max(0, start - CONTEXT_CHARS);
  let contextEnd = Math.min(text.length, end + CONTEXT_CHARS);
  while (contextStart > 0 && /\S/.test(text[contextStart - 1] || '') && /\S/.test(text[contextStart] || '')) {
    contextStart -= 1;
  }
  while (
    contextEnd < text.length &&
    /\S/.test(text[contextEnd - 1] || '') &&
    /\S/.test(text[contextEnd] || '')
  ) {
    contextEnd += 1;
  }
  return text.slice(contextStart, contextEnd).trim();
}

function addHit(hits, seen, text, iso, matchStart, matchEnd, evidence, pattern) {
  if (!isInScope(iso)) return;
  const key = `${iso}:${matchStart}:${matchEnd}:${evidence}`;
  if (seen.has(key)) return;
  seen.add(key);
  hits.push({
    context: nearbyContext(text, matchStart, matchEnd),
    evidence,
    iso,
    matchEnd,
    matchStart,
    pattern,
  });
}

function scanDates(rawText) {
  const text = normalizeForMatching(rawText);
  const hits = [];
  const seen = new Set();

  const crossMonthRange = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|to|through)\\s*(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(${scopeYearPattern})\\b`,
    'gi',
  );
  for (const match of text.matchAll(crossMonthRange)) {
    const year = normalizeYear(match[5]);
    const dates = datesBetween(
      isoDate(year, monthNumber(match[1]), Number(match[2])),
      isoDate(year, monthNumber(match[3]), Number(match[4])),
    );
    for (const iso of dates) addHit(hits, seen, text, iso, match.index, match.index + match[0].length, match[0], 'cross-month-range');
  }

  const monthDayRange = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|to|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(${scopeYearPattern})\\b`,
    'gi',
  );
  for (const match of text.matchAll(monthDayRange)) {
    const year = normalizeYear(match[4]);
    const month = monthNumber(match[1]);
    const dates = datesBetween(
      isoDate(year, month, Number(match[2])),
      isoDate(year, month, Number(match[3])),
    );
    for (const iso of dates) addHit(hits, seen, text, iso, match.index, match.index + match[0].length, match[0], 'month-day-range');
  }

  const dayRangeMonth = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|to|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern}),?\\s+(${scopeYearPattern})\\b`,
    'gi',
  );
  for (const match of text.matchAll(dayRangeMonth)) {
    const year = normalizeYear(match[4]);
    const month = monthNumber(match[3]);
    const dates = datesBetween(
      isoDate(year, month, Number(match[1])),
      isoDate(year, month, Number(match[2])),
    );
    for (const iso of dates) addHit(hits, seen, text, iso, match.index, match.index + match[0].length, match[0], 'day-range-month');
  }

  const monthDayYear = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(${scopeYearPattern})\\b`,
    'gi',
  );
  for (const match of text.matchAll(monthDayYear)) {
    const iso = isoDate(normalizeYear(match[3]), monthNumber(match[1]), Number(match[2]));
    addHit(hits, seen, text, iso, match.index, match.index + match[0].length, match[0], 'month-day-year');
  }

  const dayMonthYear = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})(?:,)?\\s+(${scopeYearPattern})\\b`,
    'gi',
  );
  for (const match of text.matchAll(dayMonthYear)) {
    const iso = isoDate(normalizeYear(match[3]), monthNumber(match[2]), Number(match[1]));
    addHit(hits, seen, text, iso, match.index, match.index + match[0].length, match[0], 'day-month-year');
  }

  const numericDate = /\b(\d{1,2})[/-](\d{1,2})[/-](19(?:5[3-9]|60|61)|5[3-9]|60|61)\b/g;
  for (const match of text.matchAll(numericDate)) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = normalizeYear(match[3]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    const iso = isoDate(year, month, day);
    addHit(hits, seen, text, iso, match.index, match.index + match[0].length, match[0], 'numeric');
  }

  const dotDate = /\b(\d{1,2})\.(\d{1,2})\.(19(?:5[3-9]|60|61)|5[3-9]|60|61)\b/g;
  for (const match of text.matchAll(dotDate)) {
    const iso = isoDate(normalizeYear(match[3]), Number(match[2]), Number(match[1]));
    addHit(hits, seen, text, iso, match.index, match.index + match[0].length, match[0], 'dot-date');
  }

  const isoLike = /\b(195[3-9]|1960|1961)-(\d{1,2})-(\d{1,2})\b/g;
  for (const match of text.matchAll(isoLike)) {
    const iso = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    addHit(hits, seen, text, iso, match.index, match.index + match[0].length, match[0], 'iso');
  }

  const bareMonthDay = new RegExp(
    `\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*,?\\s*(?:${scopeYearPattern}))`,
    'gi',
  );
  for (const match of text.matchAll(bareMonthDay)) {
    const bounds = paragraphBounds(text, match.index);
    const paragraph = text.slice(bounds.start, bounds.end);
    const years = [...paragraph.matchAll(/\b(195[3-9]|1960|1961)\b/g)].map((yearMatch) =>
      Number(yearMatch[1]),
    );
    const uniqueYears = [...new Set(years)].filter((year) => year >= 1953 && year <= 1961);
    if (uniqueYears.length !== 1) continue;
    const iso = isoDate(uniqueYears[0], monthNumber(match[1]), Number(match[2]));
    addHit(hits, seen, text, iso, match.index, match.index + match[0].length, match[0], 'bare-month-day-year-anchored');
  }

  const bareDayMonth = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\b(?!\\s*,?\\s*(?:${scopeYearPattern}))`,
    'gi',
  );
  for (const match of text.matchAll(bareDayMonth)) {
    const bounds = paragraphBounds(text, match.index);
    const paragraph = text.slice(bounds.start, bounds.end);
    const years = [...paragraph.matchAll(/\b(195[3-9]|1960|1961)\b/g)].map((yearMatch) =>
      Number(yearMatch[1]),
    );
    const uniqueYears = [...new Set(years)].filter((year) => year >= 1953 && year <= 1961);
    if (uniqueYears.length !== 1) continue;
    const iso = isoDate(uniqueYears[0], monthNumber(match[2]), Number(match[1]));
    addHit(hits, seen, text, iso, match.index, match.index + match[0].length, match[0], 'bare-day-month-year-anchored');
  }

  return hits.sort((a, b) => a.matchStart - b.matchStart || a.iso.localeCompare(b.iso));
}

async function listMarkdownFiles(dir) {
  const entries = await import('node:fs/promises').then(({ readdir }) =>
    readdir(dir, { withFileTypes: true }),
  );
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function classifyAxis(docDate) {
  if (!docDate) return 'unknown';
  if (docDate >= START_DATE && docDate <= END_DATE) return 'contemporaneous';
  if (docDate > END_DATE) return 'retrospective';
  return 'other';
}

function hitHeading(hit) {
  const title = hit.meta.subject && hit.meta.subject !== hit.meta.recordNumber
    ? `${hit.meta.recordNumber} - ${hit.meta.subject}`
    : hit.meta.recordNumber;
  return title.length > 150 ? `${title.slice(0, 147)}...` : title;
}

function excerptHtml(context) {
  return html(context)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function renderReleaseBanner(searchPrefix) {
  return `
<aside class="release-banner" role="note">
  <strong>Declassification note:</strong>
  All cited documents are part of NARA's
  <a href="${RELEASE_URL}">2025 JFK Assassination Records Release</a>
  and are presented as declassified public records. Any classification markings shown in the original files indicate their original classifications, not a current classification status.
</aside>

<form class="site-search" id="site-search-form" action="${searchPrefix}search.html" method="get" role="search">
  <label for="site-search-input">Search this chronology</label>
  <div class="site-search-row">
    <input id="site-search-input" name="q" type="search" placeholder="Date, document ID, agency, excerpt..." autocomplete="off">
    <button type="submit">Search</button>
  </div>
</form>`;
}

function pageShell({ title, prefix = '', searchPrefix = prefix, intro = '', body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${html(title)}</title>
  <link rel="stylesheet" href="${prefix}style.css">
</head>
<body>
${renderReleaseBanner(searchPrefix)}
${intro ? `<section class="page-intro" aria-label="Page introduction"><p>${html(intro)}</p></section>` : ''}
${body}
</body>
</html>
`;
}

function relativeDayLink(iso) {
  return `${iso.slice(5, 7)}-${iso.slice(8, 10)}.html`;
}

function renderHit(hit, index) {
  const docDateText = hit.meta.docDate
    ? `Document dated ${formatDate(hit.meta.docDate)}`
    : 'Document date not identified';
  const classification = hit.meta.classification ? ` · ${html(hit.meta.classification)}` : '';
  return `<article class="hit" id="hit-${index}">
<h4>${html(hitHeading(hit))}</h4>
<p class="hit-meta"><strong>${html(hit.meta.agency)}</strong>${classification} · ${html(docDateText)} · Matched: <code>${html(hit.evidence)}</code> · Source: <a href="${attr(hit.meta.url)}">${html(hit.meta.sourceName)}</a> · <a href="${RELEASE_URL}">NARA release</a></p>
<p class="excerpt-label">Excerpt (+/-${CONTEXT_CHARS} characters around match):</p>
<blockquote>${excerptHtml(hit.context)}</blockquote>
</article>`;
}

function renderHitSection(title, className, hits) {
  if (!hits.length) {
    return `<section class="chron-section ${className}"><h2>${html(title)}</h2><p>No hits.</p></section>`;
  }
  return `<section class="chron-section ${className}"><h2>${html(title)}</h2>
${hits.map((hit, index) => renderHit(hit, index)).join('\n')}
</section>`;
}

function renderGroupedRetrospective(hits) {
  if (!hits.length) {
    return '<section class="chron-section retrospective"><h2>Retrospective</h2><p>No retrospective hits.</p></section>';
  }
  const byAgency = Map.groupBy(hits, (hit) => hit.meta.agency || 'Unknown agency');
  const sections = [...byAgency.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([agency, agencyHits]) => `<h3>${html(agency)}</h3>
${agencyHits.map((hit, index) => renderHit(hit, index)).join('\n')}`)
    .join('\n');
  return `<section class="chron-section retrospective"><h2>Retrospective</h2>${sections}</section>`;
}

function isPfiabDocument(meta) {
  const descriptor = [meta.agency, meta.originator, meta.title, meta.subject, meta.pfiabDescriptor]
    .filter(Boolean)
    .join(' ');
  return /\bPFIAB\b|PBIAB|President'?s Foreign Intelligence Advisory Board|President.?s Foreign Intelligence Advisory Board|Foreign Intelligence Advisory Board/i.test(
    descriptor,
  );
}

function isInPfiabEventScope(iso) {
  return iso && iso >= START_DATE && iso <= PFIAB_END_DATE;
}

function pfiabRecordLabel(meta) {
  return meta.displayTitle || meta.title || meta.subject || meta.recordNumber;
}

function pfiabDateLink(iso) {
  return `${iso.slice(0, 4)}/${relativeDayLink(iso)}`;
}

function renderPfiabRecordRegister(records, hitsByRecord) {
  const rows = [...records]
    .sort((a, b) => compareIso(a.docDate, b.docDate) || a.recordNumber.localeCompare(b.recordNumber))
    .map((meta) => {
      const hitCount = hitsByRecord.get(meta.recordNumber)?.length || 0;
      const docDateText = meta.docDate ? formatDate(meta.docDate) : 'Not identified';
      const originator = meta.originator || meta.agency || 'Not identified';
      return `<tr><td><a href="${attr(meta.url)}">${html(meta.recordNumber)}</a></td><td>${html(pfiabRecordLabel(meta))}</td><td>${html(docDateText)}</td><td>${html(originator)}</td><td>${hitCount.toLocaleString()}</td></tr>`;
    })
    .join('');
  if (!rows) {
    return '<p>No PFIAB-identified records were found in the scanned corpus.</p>';
  }
  return `<table>
  <thead><tr><th>Record</th><th>Title / Subject</th><th>Document Date</th><th>Originator</th><th>1953-1960 Date Hits</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderPfiabLanding(years, hitsByDate, records, allHits) {
  const hitsByRecord = Map.groupBy(allHits, (hit) => hit.meta.recordNumber);
  const hitDates = [...hitsByDate.entries()].filter(([, hits]) => hits.length);
  const rows = years
    .map((year) => {
      const yearDates = hitDates.filter(([iso]) => iso.startsWith(String(year)));
      const hitCount = yearDates.reduce((sum, [, hits]) => sum + hits.length, 0);
      const docs = new Set(yearDates.flatMap(([, hits]) => hits.map((hit) => hit.meta.recordNumber))).size;
      return `<tr><th scope="row"><a href="${year}/index.html">${year}</a></th><td>${hitCount.toLocaleString()}</td><td>${yearDates.length.toLocaleString()}</td><td>${docs.toLocaleString()}</td></tr>`;
    })
    .join('');
  const datedSection = allHits.length
    ? `<h2>Dated PFIAB References</h2>
<table>
  <thead><tr><th>Year</th><th>Date References</th><th>Days With Hits</th><th>Unique Records</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`
    : `<h2>Dated PFIAB References</h2>
<p class="notice">No PFIAB-identified records in the scanned 2025-release markdown corpus produced explicit date references from ${formatDate(
        START_DATE,
      )} through ${formatDate(PFIAB_END_DATE)} under the same extraction rules used by the main chronology.</p>`;
  const body = `<nav class="breadcrumb" aria-label="Breadcrumb"><a href="../index.html">Home</a> &gt; <span>PFIAB</span></nav>
<h1>President's Foreign Intelligence Advisory Board Documents</h1>
<p>This focused section keeps only records whose release metadata, title, or converted document heading identifies PFIAB or the President's Foreign Intelligence Advisory Board. It then filters those records to explicit references dated ${formatDate(
    START_DATE,
  )} through ${formatDate(PFIAB_END_DATE)}.</p>
<p class="page-total"><em>${records.length.toLocaleString()} PFIAB-identified records scanned; ${allHits.length.toLocaleString()} dated references found.</em></p>
${datedSection}
<h2>PFIAB Records Checked</h2>
${renderPfiabRecordRegister(records, hitsByRecord)}`;
  return pageShell({
    title: 'PFIAB Documents: 1953-1960 Event References',
    prefix: '../',
    searchPrefix: '',
    intro:
      "This page is a provenance-filtered subsection of the Eisenhower chronology for President's Foreign Intelligence Advisory Board records only.",
    body,
  });
}

function pfiabHitNav(hitDates, iso) {
  const index = hitDates.indexOf(iso);
  const previous = index > 0 ? hitDates[index - 1] : null;
  const next = index < hitDates.length - 1 ? hitDates[index + 1] : null;
  return `<nav class="day-nav" aria-label="PFIAB day navigation">
  ${previous ? `<a href="../${pfiabDateLink(previous)}">&larr; ${formatDate(previous)}</a>` : '<span></span>'}
  <a href="../index.html">PFIAB section</a>
  ${next ? `<a href="../${pfiabDateLink(next)}">${formatDate(next)} &rarr;</a>` : '<span></span>'}
</nav>`;
}

function renderPfiabDayPage(iso, hits, hitDates) {
  const sorted = [...hits].sort(
    (a, b) =>
      compareIso(a.meta.docDate, b.meta.docDate) ||
      a.meta.recordNumber.localeCompare(b.meta.recordNumber) ||
      a.matchStart - b.matchStart,
  );
  const documentCount = new Set(sorted.map((hit) => hit.meta.recordNumber)).size;
  const body = `<nav class="breadcrumb" aria-label="Breadcrumb"><a href="../../index.html">Home</a> &gt; <a href="../index.html">PFIAB</a> &gt; <span>${formatDate(
    iso,
  )}</span></nav>
${pfiabHitNav(hitDates, iso)}
<main class="daily-content">
<h1>${formatDate(iso)}</h1>
${renderHitSection('PFIAB Documents', 'contemporaneous', sorted)}
<p class="page-total"><em>${sorted.length.toLocaleString()} references from ${documentCount.toLocaleString()} PFIAB-identified records in the 2025 NARA JFK release.</em></p>
</main>
${pfiabHitNav(hitDates, iso)}`;
  return pageShell({
    title: `PFIAB - ${formatDate(iso)}`,
    prefix: '../../',
    searchPrefix: '../',
    intro: `This page gathers PFIAB-identified 2025-release records that explicitly mention ${formatDate(iso)}.`,
    body,
  });
}

function renderPfiabYearPage(year, hitDates, hitsByDate) {
  const yearDates = hitDates.filter((iso) => iso.startsWith(String(year)));
  const rows = yearDates
    .map((iso) => {
      const hits = hitsByDate.get(iso) || [];
      const docs = new Set(hits.map((hit) => hit.meta.recordNumber)).size;
      return `<tr><td><a href="${relativeDayLink(iso)}">${formatDate(iso)}</a></td><td>${hits.length.toLocaleString()}</td><td>${docs.toLocaleString()}</td></tr>`;
    })
    .join('');
  const body = `<nav class="breadcrumb" aria-label="Breadcrumb"><a href="../../index.html">Home</a> &gt; <a href="../index.html">PFIAB</a> &gt; <span>${year}</span></nav>
<h1>PFIAB References: ${year}</h1>
<table>
  <thead><tr><th>Date</th><th>References</th><th>Unique Records</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
  return pageShell({
    title: `PFIAB References: ${year}`,
    prefix: '../../',
    searchPrefix: '../',
    intro: `This yearly index includes only PFIAB-identified records with explicit ${year} date references.`,
    body,
  });
}

function dayNav(days, iso) {
  const index = days.indexOf(iso);
  const previous = index > 0 ? days[index - 1] : null;
  const next = index < days.length - 1 ? days[index + 1] : null;
  return `<nav class="day-nav" aria-label="Day navigation">
  ${previous ? `<a href="${relativeDayLink(previous)}">&larr; ${formatDate(previous)}</a>` : '<span></span>'}
  <a href="index.html">${iso.slice(0, 4)} calendar</a>
  ${next ? `<a href="${relativeDayLink(next)}">${formatDate(next)} &rarr;</a>` : '<span></span>'}
</nav>`;
}

function renderDayPage(iso, hits, days) {
  const dateTitle = formatDate(iso);
  const label = keyEvents.get(iso);
  const sorted = [...hits].sort((a, b) => {
    const axisOrder = { contemporaneous: 0, retrospective: 1, other: 2, unknown: 3 };
    return (
      axisOrder[classifyAxis(a.meta.docDate)] -
        axisOrder[classifyAxis(b.meta.docDate)] ||
      compareIso(a.meta.docDate, b.meta.docDate) ||
      a.meta.recordNumber.localeCompare(b.meta.recordNumber) ||
      a.matchStart - b.matchStart
    );
  });
  const contemporaneous = sorted.filter((hit) => classifyAxis(hit.meta.docDate) === 'contemporaneous');
  const retrospective = sorted.filter((hit) => classifyAxis(hit.meta.docDate) === 'retrospective');
  const other = sorted.filter((hit) => classifyAxis(hit.meta.docDate) === 'other');
  const unknown = sorted.filter((hit) => classifyAxis(hit.meta.docDate) === 'unknown');
  const documentCount = new Set(sorted.map((hit) => hit.meta.recordNumber)).size;
  const year = iso.slice(0, 4);
  const month = iso.slice(5, 7);

  const body = `<nav class="breadcrumb" aria-label="Breadcrumb"><a href="../index.html">Home</a> &gt; <a href="index.html">${year}</a> &gt; <a href="${month}/index.html">${monthName(Number(month))}</a> &gt; <span>${formatDate(iso, { noYear: true })}</span></nav>
${dayNav(days, iso)}
<main class="daily-content">
<h1>${html(dateTitle)}${label ? ` - ${html(label)}` : ''}</h1>
${label ? `<blockquote><p>${html(label)}</p></blockquote>` : ''}
${renderHitSection('Contemporaneous (Eisenhower administration)', 'contemporaneous', contemporaneous)}
${renderGroupedRetrospective(retrospective)}
${renderHitSection('Earlier Document Dates', 'other-date', other)}
${renderHitSection('Document Date Unknown', 'unknown-date', unknown)}
<p class="page-total"><em>${sorted.length.toLocaleString()} references from ${documentCount.toLocaleString()} documents in the 2025 NARA JFK release.</em></p>
</main>
${dayNav(days, iso)}`;

  return pageShell({
    title: dateTitle,
    prefix: '../',
    intro: `This daily page gathers records that mention ${dateTitle}, separating same-period Eisenhower administration documents, later retrospective records, and records with unidentified document dates.`,
    body,
  });
}

function hitDensityClass(count) {
  if (!count) return 'hit-0';
  if (count <= 5) return 'hit-low';
  if (count <= 20) return 'hit-medium';
  return 'hit-high';
}

function renderCalendarMonth(year, month, hitsByDate, scopedDates) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const rows = [];
  let row = Array.from({ length: first.getUTCDay() }, () => '<td class="out-of-scope"></td>');
  for (let day = 1; day <= last.getUTCDate(); day += 1) {
    const iso = isoDate(year, month, day);
    const inScope = scopedDates.has(iso);
    if (!inScope) {
      row.push('<td class="out-of-scope"></td>');
    } else {
      const count = hitsByDate.get(iso)?.length || 0;
      const title = `${keyEvents.get(iso) || formatDate(iso)}: ${count} hits`;
      row.push(`<td class="${hitDensityClass(count)}"><a title="${attr(title)}" href="${relativeDayLink(iso)}">${day}</a></td>`);
    }
    if (row.length === 7) {
      rows.push(`<tr>${row.join('')}</tr>`);
      row = [];
    }
  }
  if (row.length) {
    while (row.length < 7) row.push('<td class="out-of-scope"></td>');
    rows.push(`<tr>${row.join('')}</tr>`);
  }
  return `<section class="month-card">
  <h2><a href="${String(month).padStart(2, '0')}/index.html">${monthName(month)}</a></h2>
  <table class="calendar-month">
    <thead><tr><th>Sun</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>
</section>`;
}

function renderYearPage(year, days, hitsByDate) {
  const scopedDates = new Set(days.filter((iso) => iso.startsWith(String(year))));
  const hitDates = [...scopedDates].filter((iso) => (hitsByDate.get(iso)?.length || 0) > 0);
  const topDays = [...scopedDates]
    .map((iso) => ({
      count: hitsByDate.get(iso)?.length || 0,
      iso,
      label: keyEvents.get(iso) || '',
    }))
    .sort((a, b) => b.count - a.count || a.iso.localeCompare(b.iso))
    .slice(0, 10);
  const months = [...new Set([...scopedDates].map((iso) => Number(iso.slice(5, 7))))].sort((a, b) => a - b);
  const body = `<nav class="breadcrumb" aria-label="Breadcrumb"><a href="../index.html">Home</a> &gt; <span>${year}</span></nav>
<h1>${year}</h1>
<p>${hitDates.length.toLocaleString()} of ${scopedDates.size.toLocaleString()} in-scope days have at least one reference. Color density: white = 0, light blue = 1-5, medium blue = 6-20, dark blue = 21+.</p>
<div class="calendar-grid">
${months.map((month) => renderCalendarMonth(year, month, hitsByDate, scopedDates)).join('\n')}
</div>
<h2>Top 10 Days By Hit Count</h2>
<table>
  <thead><tr><th>Date</th><th>Label</th><th>Hits</th></tr></thead>
  <tbody>${topDays
    .map(
      (day) =>
        `<tr><td><a href="${relativeDayLink(day.iso)}">${day.iso}</a></td><td>${html(day.label)}</td><td>${day.count.toLocaleString()}</td></tr>`,
    )
    .join('')}</tbody>
</table>`;
  return pageShell({
    title: `${year} Calendar`,
    prefix: '../',
    intro:
      'This calendar shows every in-scope day in the Eisenhower administration window and uses color density to show how often each date is referenced in the release.',
    body,
  });
}

function renderMonthPage(year, month, days, hitsByDate) {
  const monthDays = days.filter(
    (iso) => Number(iso.slice(0, 4)) === year && Number(iso.slice(5, 7)) === month,
  );
  const rows = monthDays
    .map((iso) => {
      const hits = hitsByDate.get(iso) || [];
      const documents = new Set(hits.map((hit) => hit.meta.recordNumber)).size;
      return `<tr><td><a href="../${relativeDayLink(iso)}">${formatDate(iso)}</a></td><td>${html(
        keyEvents.get(iso) || '',
      )}</td><td>${hits.length.toLocaleString()}</td><td>${documents.toLocaleString()}</td></tr>`;
    })
    .join('');
  const topHits = [...monthDays]
    .map((iso) => ({
      iso,
      count: hitsByDate.get(iso)?.length || 0,
      documents: new Set((hitsByDate.get(iso) || []).map((hit) => hit.meta.recordNumber)).size,
    }))
    .sort((a, b) => b.count - a.count || a.iso.localeCompare(b.iso))
    .slice(0, 8);
  const body = `<nav class="breadcrumb" aria-label="Breadcrumb"><a href="../../index.html">Home</a> &gt; <a href="../index.html">${year}</a> &gt; <span>${monthName(month)}</span></nav>
<h1>${monthName(month)} ${year}</h1>
<p>${monthDays.length.toLocaleString()} in-scope days. ${monthDays
    .reduce((sum, iso) => sum + (hitsByDate.get(iso)?.length || 0), 0)
    .toLocaleString()} total date references in the release.</p>
<h2>Daily Rollup</h2>
<table>
  <thead><tr><th>Date</th><th>Label</th><th>References</th><th>Documents</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<h2>Highest-Density Days</h2>
<table>
  <thead><tr><th>Date</th><th>References</th><th>Documents</th></tr></thead>
  <tbody>${topHits
    .map(
      (day) =>
        `<tr><td><a href="../${relativeDayLink(day.iso)}">${formatDate(day.iso)}</a></td><td>${day.count.toLocaleString()}</td><td>${day.documents.toLocaleString()}</td></tr>`,
    )
    .join('')}</tbody>
</table>`;
  return pageShell({
    title: `${monthName(month)} ${year}`,
    prefix: '../../',
    intro:
      'This monthly rollup links each date to its daily evidence page and gives a quick count of references and unique documents.',
    body,
  });
}

function renderLanding(years, days, hitsByDate, docsScanned, allHits, pfiabSummary) {
  const rows = years
    .map((year) => {
      const yearDays = days.filter((iso) => iso.startsWith(String(year)));
      const hitCount = yearDays.reduce((sum, iso) => sum + (hitsByDate.get(iso)?.length || 0), 0);
      const hitDays = yearDays.filter((iso) => (hitsByDate.get(iso)?.length || 0) > 0).length;
      const docs = new Set(yearDays.flatMap((iso) => (hitsByDate.get(iso) || []).map((hit) => hit.meta.recordNumber))).size;
      const months = new Set(yearDays.map((iso) => iso.slice(5, 7))).size;
      return `<tr><th scope="row"><a href="${year}/index.html">${year}</a></th><td>${docsScanned.toLocaleString()}</td><td>${hitCount.toLocaleString()}</td><td>${hitDays.toLocaleString()} / ${yearDays.length.toLocaleString()}</td><td>${docs.toLocaleString()}</td><td>${months}</td></tr>`;
    })
    .join('');
  const uniqueDocs = new Set(allHits.map((hit) => hit.meta.recordNumber)).size;
  const totalDaysWithHits = days.filter((iso) => (hitsByDate.get(iso)?.length || 0) > 0).length;
  const body = `<h1>Dwight D. Eisenhower Administration Day-by-Day</h1>
<p>This site presents a day-level chronology of the Eisenhower administration from the 2025 NARA JFK assassination records release, using the doctly/jfk markdown corpus. Each daily page writes released documents to the specific date they mention, separating contemporaneous Eisenhower-era records from later retrospective references.</p>
<p><strong>Window:</strong> ${formatDate(START_DATE)} through ${formatDate(END_DATE)}. The first day is Eisenhower's inauguration; the last day is the day before John F. Kennedy's inauguration.</p>
<h2>Summary Stats</h2>
<table>
  <thead>
    <tr>
      <th>Year</th>
      <th>Documents scanned</th>
      <th>Date hits</th>
      <th>Days with hits</th>
      <th>Unique docs cited</th>
      <th>Monthly rollups</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<p>${allHits.length.toLocaleString()} total date references from ${uniqueDocs.toLocaleString()} unique documents across ${totalDaysWithHits.toLocaleString()} days.</p>
<h2>Calendars</h2>
<ul class="year-links">
${years.map((year) => `<li><a href="${year}/index.html">${year} calendar</a></li>`).join('\n')}
</ul>
<h2>Focused Sections</h2>
<ul class="year-links">
  <li><a href="${PFIAB_SECTION_DIR}/index.html">PFIAB documents on 1953-1960 events</a> (${pfiabSummary.dateHits.toLocaleString()} dated references from ${pfiabSummary.records.toLocaleString()} PFIAB-identified records)</li>
</ul>
<h2>Sources</h2>
<p>Source markdown links point to the public doctly/jfk conversion repository. The release banner links to NARA's 2025 JFK assassination records release page.</p>`;
  return pageShell({
    title: 'Eisenhower Administration Day-by-Day',
    intro:
      'This landing page introduces the Eisenhower administration chronology, summarizes the yearly datasets, and links to the browsable calendars.',
    body,
  });
}

function renderSearchPage(options = {}) {
  const heading = options.heading || 'Search';
  const description =
    options.description ||
    'Search dates, document IDs, agencies, key event labels, yearly calendars, monthly rollups, and excerpt text. Results link to the generated chronology pages.';
  const body = `<h1>${html(heading)}</h1>
<p>${html(description)}</p>
<div id="search-results" class="search-results">Enter a search term above.</div>
<script src="search.js" defer></script>`;
  return pageShell({
    title: options.title || 'Search',
    prefix: options.prefix || '',
    searchPrefix: options.searchPrefix ?? options.prefix ?? '',
    intro:
      options.intro ||
      'This search page looks across the generated daily pages, monthly rollups, calendars, and source excerpts in this public chronology.',
    body,
  });
}

const stylesheet = `body {
  background: #fff;
  color: #202124;
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.55;
  margin: 0 auto;
  max-width: 880px;
  padding: 2rem 1rem 4rem;
}

a { color: #0b57d0; }

table {
  border-collapse: collapse;
  margin: 1rem 0 1.5rem;
  width: 100%;
}

th,
td {
  border-bottom: 1px solid #dadce0;
  padding: 0.45rem 0.5rem;
  text-align: left;
  vertical-align: top;
}

blockquote {
  border-left: 4px solid #dadce0;
  color: #303134;
  margin: 1rem 0;
  padding: 0.25rem 0 0.25rem 1rem;
}

code,
pre,
.daily-content h3,
.daily-content h4 {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

.breadcrumb,
.day-nav {
  color: #5f6368;
  font-size: 0.95rem;
  margin: 0 0 1rem;
}

.day-nav {
  border-bottom: 1px solid #dadce0;
  border-top: 1px solid #dadce0;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: 1fr auto 1fr;
  padding: 0.65rem 0;
}

.day-nav a:last-child { text-align: right; }

.calendar-grid {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
}

.month-card h2 {
  font-size: 1.15rem;
  margin-bottom: 0.4rem;
}

.calendar-month th,
.calendar-month td {
  border: 1px solid #dadce0;
  padding: 0;
  text-align: center;
}

.calendar-month th {
  font-size: 0.75rem;
  padding: 0.25rem;
}

.calendar-month a {
  color: inherit;
  display: block;
  min-height: 1.9rem;
  padding-top: 0.35rem;
  text-decoration: none;
}

.out-of-scope { background: #f8f9fa; }
.hit-0 { background: #fff; }
.hit-low { background: #d7e8ff; }
.hit-medium { background: #7eb6f6; }
.hit-high {
  background: #185abc;
  color: #fff;
}

.chron-section {
  border-left: 5px solid #dadce0;
  margin: 1.5rem 0;
  padding-left: 1rem;
}

.chron-section.contemporaneous { border-left-color: #1a73e8; }
.chron-section.retrospective { border-left-color: #f29900; }
.chron-section.other-date { border-left-color: #7b1fa2; }
.chron-section.unknown-date { border-left-color: #80868b; }

.hit {
  border-top: 1px solid #e8eaed;
  margin: 1rem 0 0;
  padding-top: 0.75rem;
}

.hit h4 { margin-bottom: 0.35rem; }
.hit-meta,
.excerpt-label,
.notice,
.page-total,
.search-count,
.search-empty,
.search-meta {
  color: #5f6368;
}

.year-links {
  columns: 2;
  font-size: 1.1rem;
}

.site-search {
  border-bottom: 1px solid #dadce0;
  margin: 0 0 1.25rem;
  padding: 0 0 1rem;
}

.site-search label {
  color: #3c4043;
  display: block;
  font-size: 0.9rem;
  margin: 0 0 0.35rem;
}

.site-search-row {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: 1fr auto;
}

.site-search input {
  border: 1px solid #bdc1c6;
  border-radius: 6px;
  font: inherit;
  min-width: 0;
  padding: 0.5rem 0.6rem;
}

.site-search button {
  background: #174ea6;
  border: 1px solid #174ea6;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  font: inherit;
  padding: 0.5rem 0.8rem;
}

.search-list { padding-left: 1.4rem; }
.search-result { margin: 0 0 1.25rem; }
.search-result h2 {
  font-size: 1.15rem;
  margin: 0 0 0.2rem;
}
.search-result p { margin: 0.2rem 0; }

.release-banner {
  background: #fff8e8;
  border: 1px solid #f0c36d;
  border-left: 5px solid #d97706;
  margin: 0 0 1.5rem;
  padding: 0.75rem 0.9rem;
}

.page-intro {
  color: #3c4043;
  margin: 0 0 1.25rem;
}

.page-intro p { margin: 0; }

@media (max-width: 620px) {
  body { padding-top: 1rem; }
  .day-nav { grid-template-columns: 1fr; }
  .day-nav a:last-child { text-align: left; }
  .site-search-row { grid-template-columns: 1fr; }
  .year-links { columns: 1; }
}
`;

const searchScript = `async function runSearch() {
  const params = new URLSearchParams(window.location.search);
  const query = (params.get('q') || '').trim();
  const input = document.getElementById('site-search-input');
  if (input) input.value = query;
  const container = document.getElementById('search-results');
  if (!container || !query) return;
  container.textContent = 'Searching...';
  const response = await fetch('search-index.json');
  const index = await response.json();
  const terms = query.toLowerCase().split(/\\s+/).filter(Boolean);
  const results = index
    .filter((item) => terms.every((term) => item.text.includes(term)))
    .slice(0, 75);
  if (!results.length) {
    container.innerHTML = '<p class="search-empty">No results found.</p>';
    return;
  }
  container.innerHTML = '<p class="search-count">' + results.length.toLocaleString() + ' results shown.</p>' +
    '<ol class="search-list">' + results.map((item) =>
      '<li class="search-result"><h2><a href="' + item.url + '">' + escapeHtml(item.title) + '</a></h2>' +
      '<p class="search-meta">' + escapeHtml(item.meta || '') + '</p>' +
      '<p>' + escapeHtml(item.snippet || '').slice(0, 420) + '</p></li>'
    ).join('') + '</ol>';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[char]));
}

runSearch().catch((error) => {
  const container = document.getElementById('search-results');
  if (container) container.textContent = 'Search failed: ' + error.message;
});
`;

function searchEntry({ title, url, meta = '', snippet = '', text }) {
  const fullText = normalizeSpaces(text || `${title} ${meta} ${snippet}`).toLowerCase();
  return {
    meta,
    snippet: normalizeSpaces(snippet),
    text: fullText,
    title,
    url,
  };
}

async function cleanGeneratedOutput(outputDir, years) {
  await mkdir(outputDir, { recursive: true });
  const generatedNames = [
    'index.html',
    'search.html',
    'search.js',
    'search-index.json',
    'style.css',
    'summary.json',
    PFIAB_SECTION_DIR,
    ...years.map(String),
  ];
  await Promise.all(
    generatedNames.map((name) => rm(path.join(outputDir, name), { recursive: true, force: true })),
  );
}

async function writePfiabSection(outputDir, records, hitsByDate, allHits) {
  const sectionDir = path.join(outputDir, PFIAB_SECTION_DIR);
  await mkdir(sectionDir, { recursive: true });
  const hitDates = [...hitsByDate.keys()].filter((iso) => (hitsByDate.get(iso)?.length || 0) > 0);
  const years = [...new Set(hitDates.map((iso) => Number(iso.slice(0, 4))))];

  await writeFile(path.join(sectionDir, 'search.js'), searchScript);
  await writeFile(
    path.join(sectionDir, 'search.html'),
    renderSearchPage({
      title: 'Search PFIAB Documents',
      heading: 'Search PFIAB Documents',
      prefix: '../',
      searchPrefix: '',
      intro:
        "This search page looks only across the President's Foreign Intelligence Advisory Board subsection.",
      description:
        'Search dates, document IDs, originators, titles, and excerpts within the PFIAB-focused subsection.',
    }),
  );
  await writeFile(path.join(sectionDir, 'index.html'), renderPfiabLanding(years, hitsByDate, records, allHits));

  for (const year of years) {
    const yearDir = path.join(sectionDir, String(year));
    await mkdir(yearDir, { recursive: true });
    await writeFile(path.join(yearDir, 'index.html'), renderPfiabYearPage(year, hitDates, hitsByDate));
    for (const iso of hitDates.filter((date) => date.startsWith(String(year)))) {
      await writeFile(path.join(yearDir, relativeDayLink(iso)), renderPfiabDayPage(iso, hitsByDate.get(iso) || [], hitDates));
    }
  }

  const searchIndex = [
    searchEntry({
      title: 'PFIAB Documents: 1953-1960 Event References',
      url: 'index.html',
      meta: `${formatDate(START_DATE)} through ${formatDate(PFIAB_END_DATE)}`,
      snippet: `${records.length.toLocaleString()} PFIAB-identified records scanned; ${allHits.length.toLocaleString()} dated references found.`,
    }),
    ...records.map((meta) =>
      searchEntry({
        title: `${meta.recordNumber} - ${pfiabRecordLabel(meta)}`,
        url: 'index.html',
        meta: `${meta.originator || meta.agency}; ${meta.docDate ? formatDate(meta.docDate) : 'document date unknown'}`,
        snippet: `${meta.title || ''} ${meta.subject || ''}`,
      }),
    ),
    ...years.map((year) =>
      searchEntry({
        title: `PFIAB references: ${year}`,
        url: `${year}/index.html`,
        meta: 'PFIAB yearly index',
        snippet: `PFIAB-identified records with explicit ${year} date references.`,
      }),
    ),
    ...hitDates.flatMap((iso) => {
      const hits = hitsByDate.get(iso) || [];
      const baseEntry = searchEntry({
        title: `PFIAB - ${formatDate(iso)}`,
        url: pfiabDateLink(iso),
        meta: `${hits.length.toLocaleString()} references`,
        snippet: hits
          .slice(0, 3)
          .map((hit) => `${hit.meta.recordNumber} ${hit.evidence} ${hit.context}`)
          .join(' '),
      });
      const hitEntries = hits.map((hit) =>
        searchEntry({
          title: `PFIAB - ${formatDate(iso)} - ${hit.meta.recordNumber}`,
          url: pfiabDateLink(iso),
          meta: `${hit.meta.originator || hit.meta.agency}; ${
            hit.meta.docDate ? formatDate(hit.meta.docDate) : 'document date unknown'
          }`,
          snippet: `${hit.evidence}: ${hit.context}`,
        }),
      );
      return [baseEntry, ...hitEntries];
    }),
  ];
  await writeFile(path.join(sectionDir, 'search-index.json'), JSON.stringify(searchIndex));
}

async function main() {
  if (!existsSync(CORPUS_DIR)) {
    throw new Error(`Corpus directory not found: ${CORPUS_DIR}`);
  }

  const markdownFiles = await listMarkdownFiles(CORPUS_DIR);
  const hitsByDate = new Map(eachDay().map((iso) => [iso, []]));
  const pfiabHitsByDate = new Map(eachDay(START_DATE, PFIAB_END_DATE).map((iso) => [iso, []]));
  const allHits = [];
  const pfiabAllHits = [];
  const pfiabRecordsByPath = new Map();
  const metadataByRecord = new Map();

  for (const filePath of markdownFiles) {
    const relPath = path.relative(CORPUS_DIR, filePath);
    const text = await readFile(filePath, 'utf8');
    const meta = parseMetadata(text, relPath);
    metadataByRecord.set(meta.recordNumber, meta);
    const pfiabDocument = isPfiabDocument(meta);
    if (pfiabDocument) pfiabRecordsByPath.set(meta.relPath, meta);
    const hits = scanDates(text);
    for (const hit of hits) {
      const enriched = { ...hit, meta };
      hitsByDate.get(hit.iso)?.push(enriched);
      allHits.push(enriched);
      if (pfiabDocument && isInPfiabEventScope(hit.iso)) {
        pfiabHitsByDate.get(hit.iso)?.push(enriched);
        pfiabAllHits.push(enriched);
      }
    }
  }

  for (const hits of hitsByDate.values()) {
    hits.sort((a, b) => compareIso(a.meta.docDate, b.meta.docDate) || a.meta.recordNumber.localeCompare(b.meta.recordNumber));
  }
  for (const hits of pfiabHitsByDate.values()) {
    hits.sort((a, b) => compareIso(a.meta.docDate, b.meta.docDate) || a.meta.recordNumber.localeCompare(b.meta.recordNumber));
  }

  const days = eachDay();
  const years = [...new Set(days.map((iso) => Number(iso.slice(0, 4))))];
  const pfiabRecords = [...pfiabRecordsByPath.values()];
  await cleanGeneratedOutput(OUTPUT_DIR, years);
  await writeFile(path.join(OUTPUT_DIR, 'style.css'), stylesheet);
  await writeFile(path.join(OUTPUT_DIR, 'search.js'), searchScript);
  await writeFile(path.join(OUTPUT_DIR, 'search.html'), renderSearchPage());
  await writeFile(
    path.join(OUTPUT_DIR, 'index.html'),
    renderLanding(years, days, hitsByDate, markdownFiles.length, allHits, {
      dateHits: pfiabAllHits.length,
      records: pfiabRecords.length,
    }),
  );

  for (const year of years) {
    const yearDir = path.join(OUTPUT_DIR, String(year));
    await mkdir(yearDir, { recursive: true });
    await writeFile(path.join(yearDir, 'index.html'), renderYearPage(year, days, hitsByDate));
    for (const iso of days.filter((day) => day.startsWith(String(year)))) {
      await writeFile(path.join(yearDir, relativeDayLink(iso)), renderDayPage(iso, hitsByDate.get(iso) || [], days));
    }
    const months = [
      ...new Set(days.filter((day) => day.startsWith(String(year))).map((day) => Number(day.slice(5, 7)))),
    ];
    for (const month of months) {
      const monthDir = path.join(yearDir, String(month).padStart(2, '0'));
      await mkdir(monthDir, { recursive: true });
      await writeFile(path.join(monthDir, 'index.html'), renderMonthPage(year, month, days, hitsByDate));
    }
  }
  await writePfiabSection(OUTPUT_DIR, pfiabRecords, pfiabHitsByDate, pfiabAllHits);

  const searchIndex = [
    searchEntry({
      title: 'Eisenhower Administration Day-by-Day',
      url: 'index.html',
      meta: `${formatDate(START_DATE)} through ${formatDate(END_DATE)}`,
      snippet: `${allHits.length.toLocaleString()} date references from ${markdownFiles.length.toLocaleString()} scanned documents.`,
    }),
    ...years.map((year) =>
      searchEntry({
        title: `${year} calendar`,
        url: `${year}/index.html`,
        meta: 'Year calendar',
        snippet: `Calendar for ${year} in the Eisenhower administration chronology.`,
      }),
    ),
    ...days.flatMap((iso) => {
      const hits = hitsByDate.get(iso) || [];
      const baseEntry = searchEntry({
        title: `${formatDate(iso)}${keyEvents.get(iso) ? ` - ${keyEvents.get(iso)}` : ''}`,
        url: `${iso.slice(0, 4)}/${relativeDayLink(iso)}`,
        meta: `${hits.length.toLocaleString()} references`,
        snippet: hits
          .slice(0, 3)
          .map((hit) => `${hit.meta.recordNumber} ${hit.evidence} ${hit.context}`)
          .join(' '),
      });
      const hitEntries = hits.map((hit) =>
        searchEntry({
          title: `${formatDate(iso)} - ${hit.meta.recordNumber}`,
          url: `${iso.slice(0, 4)}/${relativeDayLink(iso)}`,
          meta: `${hit.meta.agency}; ${hit.meta.docDate ? formatDate(hit.meta.docDate) : 'document date unknown'}`,
          snippet: `${hit.evidence}: ${hit.context}`,
        }),
      );
      return [baseEntry, ...hitEntries];
    }),
  ];
  await writeFile(path.join(OUTPUT_DIR, 'search-index.json'), JSON.stringify(searchIndex));

  const summary = {
    corpusDir: CORPUS_DIR,
    documentsScanned: markdownFiles.length,
    endDate: END_DATE,
    generatedAt: new Date().toISOString(),
    outputDir: OUTPUT_DIR,
    startDate: START_DATE,
    totalDateHits: allHits.length,
    uniqueDocumentsWithHits: new Set(allHits.map((hit) => hit.meta.recordNumber)).size,
    pfiabSection: {
      endDate: PFIAB_END_DATE,
      recordsScanned: pfiabRecords.length,
      totalDateHits: pfiabAllHits.length,
      uniqueDocumentsWithHits: new Set(pfiabAllHits.map((hit) => hit.meta.recordNumber)).size,
      daysWithHits: [...pfiabHitsByDate.values()].filter((hits) => hits.length > 0).length,
    },
    daysInScope: days.length,
    daysWithHits: days.filter((iso) => (hitsByDate.get(iso)?.length || 0) > 0).length,
    byYear: Object.fromEntries(
      years.map((year) => {
        const yearDays = days.filter((iso) => iso.startsWith(String(year)));
        return [
          year,
          {
            dateHits: yearDays.reduce((sum, iso) => sum + (hitsByDate.get(iso)?.length || 0), 0),
            daysInScope: yearDays.length,
            daysWithHits: yearDays.filter((iso) => (hitsByDate.get(iso)?.length || 0) > 0).length,
            uniqueDocuments: new Set(
              yearDays.flatMap((iso) => (hitsByDate.get(iso) || []).map((hit) => hit.meta.recordNumber)),
            ).size,
          },
        ];
      }),
    ),
  };
  await writeFile(path.join(OUTPUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
