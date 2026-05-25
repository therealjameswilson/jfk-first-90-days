function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function withoutFinalPeriod(value) {
  return normalizeText(value).replace(/\.$/, '');
}

function cleanTitle(value) {
  return withoutFinalPeriod(value).replace(/^\d+\.\s*/, '');
}

function quotedTitle(value) {
  const title = cleanTitle(value);
  return title ? `"${title}"` : '';
}

function formatFullDate(iso) {
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function citationDate(doc) {
  const displayDate = normalizeText(doc.displayDate);
  if (doc.date && (!doc.endDate || doc.date === doc.endDate)) return formatFullDate(doc.date) || displayDate;
  if (displayDate && displayDate !== 'Undated') return displayDate;
  return normalizeText(doc.date);
}

function pagesFromCitation(value) {
  const match = normalizeText(value).match(/\bpp?\.?\s+([0-9ivxlcdm,\s-]+)/i);
  if (!match) return '';
  const label = match[0].toLowerCase().startsWith('p.') && !match[0].toLowerCase().startsWith('pp')
    ? 'p.'
    : 'pp.';
  return `${label} ${normalizeText(match[1])}`;
}

function partsToSentence(parts) {
  const text = parts.map(normalizeText).filter(Boolean).join(', ');
  return text ? `${withoutFinalPeriod(text)}.`.replace(/",/g, ',"').replace(/"\./g, '."') : '';
}

function documentNumber(doc, label = '') {
  const value = normalizeText(doc.documentNumber);
  if (!value) return '';
  const container = sourceContainer(doc).toLowerCase();
  if (container.includes(value.toLowerCase())) return '';
  if (!label || new RegExp(`^${label}\\b`, 'i').test(value)) return value;
  if (label === 'doc.' && /\b(doc|document)\b/i.test(value)) return value;
  return `${label} ${value}`;
}

function archiveLocator(doc) {
  const value = normalizeText(doc.documentNumber);
  if (!value || /^[a-z0-9-]+$/.test(value)) return '';
  return value;
}

function sourceContainer(doc) {
  return normalizeText(doc.container || doc.collection);
}

function formatFrusCitation(doc) {
  return partsToSentence([
    'U.S. Department of State',
    'Foreign Relations of the United States, 1961-1963',
    doc.container,
    documentNumber(doc, 'doc.'),
    quotedTitle(doc.title),
    citationDate(doc),
  ]);
}

function formatJfkLibraryCitation(doc) {
  return partsToSentence([
    'John F. Kennedy Presidential Library and Museum',
    quotedTitle(doc.title),
    sourceContainer(doc),
    archiveLocator(doc),
    citationDate(doc),
  ]);
}

function formatNaraCitation(doc) {
  return partsToSentence([
    'National Archives and Records Administration',
    quotedTitle(doc.title),
    doc.collection,
    doc.container,
    documentNumber(doc, 'National Archives Identifier'),
    citationDate(doc),
  ]);
}

function formatDodHistoryCitation(doc) {
  return partsToSentence([
    'Office of the Secretary of Defense Historical Office',
    quotedTitle(doc.title),
    sourceContainer(doc),
    documentNumber(doc),
    citationDate(doc),
  ]);
}

function formatJcsHistoryCitation(doc) {
  const pages = pagesFromCitation(doc.citation || doc.documentNumber);
  return partsToSentence([
    'Walter S. Poole',
    'The Joint Chiefs of Staff and National Policy, Volume VIII, 1961-1964 (Washington, DC: Office of Joint History, Office of the Chairman of the Joint Chiefs of Staff, 2011)',
    pages,
  ]);
}

function formatGovInfoCitation(doc) {
  const pages = pagesFromCitation(doc.citation);
  return partsToSentence([
    'John F. Kennedy',
    quotedTitle(doc.title),
    'Public Papers of the Presidents of the United States: John F. Kennedy (1961), Book 1 (Washington, DC: Government Publishing Office, 1961)',
    doc.documentNumber,
    pages,
  ]);
}

function formatCiaCitation(doc) {
  return partsToSentence([
    'Central Intelligence Agency',
    quotedTitle(doc.title),
    sourceContainer(doc),
    documentNumber(doc, 'doc.'),
    citationDate(doc),
  ]);
}

function formatStateCitation(doc) {
  return partsToSentence([
    'U.S. Department of State',
    quotedTitle(doc.title),
    'Department of State FOIA Library',
    sourceContainer(doc),
    doc.documentNumber,
    citationDate(doc),
  ]);
}

function formatIscapCitation(doc) {
  return partsToSentence([
    'Interagency Security Classification Appeals Panel',
    quotedTitle(doc.title),
    sourceContainer(doc),
    doc.documentNumber,
    citationDate(doc),
  ]);
}

function formatNationalSecurityArchiveCitation(doc) {
  return partsToSentence([
    'National Security Archive',
    quotedTitle(doc.title),
    sourceContainer(doc),
    citationDate(doc),
  ]);
}

function formatNitzeCitation(doc) {
  return partsToSentence([
    'Paul H. Nitze',
    quotedTitle(doc.title),
    sourceContainer(doc),
    doc.documentNumber,
    citationDate(doc),
  ]);
}

function formatFallbackCitation(doc) {
  return partsToSentence([
    doc.repository || doc.source,
    quotedTitle(doc.title),
    sourceContainer(doc),
    doc.documentNumber,
    citationDate(doc),
  ]);
}

export function formatRandomHouseCitation(doc) {
  if (doc.source === 'FRUS') return formatFrusCitation(doc);
  if (doc.source === 'JFK Library') return formatJfkLibraryCitation(doc);
  if (doc.source === 'NARA Catalog') return formatNaraCitation(doc);
  if (doc.source === 'DOD History') return formatDodHistoryCitation(doc);
  if (doc.source === 'JCS History') return formatJcsHistoryCitation(doc);
  if (doc.source === 'GovInfo PPP') return formatGovInfoCitation(doc);
  if (doc.source === 'CIA FOIA') return formatCiaCitation(doc);
  if (doc.source === 'State FOIA') return formatStateCitation(doc);
  if (doc.source === 'ISCAP') return formatIscapCitation(doc);
  if (doc.source === 'National Security Archive') return formatNationalSecurityArchiveCitation(doc);
  if (doc.source === 'Nitze Interviews') return formatNitzeCitation(doc);
  return formatFallbackCitation(doc);
}
