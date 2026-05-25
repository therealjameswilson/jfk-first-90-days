import { mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { supplementalRecords } from './supplemental-sources.mjs';

const START_DATE = '1961-01-20';
const END_DATE = '1961-04-20';
const FRUS_TREE_URL =
  'https://api.github.com/repos/HistoryAtState/frus/git/trees/master?recursive=1';
const FRUS_RAW_BASE =
  'https://raw.githubusercontent.com/HistoryAtState/frus/master/';
const FRUS_HTML_BASE = 'https://history.state.gov/historicaldocuments';
const NARA_SEARCH_URL = 'https://catalog.archives.gov/proxy/records/search';
const NARA_CATALOG_BASE = 'https://catalog.archives.gov/id';
const JFK_ASSET_BASE = 'https://www.jfklibrary.org/asset-viewer/archives';

const topicRules = [
  ['Peace Corps', ['peace corps']],
  ['Bay of Pigs', ['bay of pigs', 'playa giron', 'zapata', 'cuban invasion']],
  ['Cuba', ['cuba', 'cuban', 'castro', 'havana', 'caribbean']],
  ['Laos', ['laos', 'laotian', 'pathet lao', 'vientiane']],
  ['Vietnam', ['vietnam', 'viet-nam', 'viet minh', 'viet cong', 'diem', 'saigon']],
  ['Congo', ['congo', 'katanga', 'lumumba', 'leopoldville', 'youlu']],
  ['USSR', ['ussr', 'soviet', 'khrushchev', 'gromyko', 'moscow']],
  ['Berlin', ['berlin', 'adenauer', 'germany', 'german']],
  ['NATO', ['nato', 'saceur', 'allied commander', 'europe']],
  ['Nuclear', ['nuclear', 'atomic', 'test ban', 'disarmament', 'irbm', 'missile']],
  ['Foreign Aid', ['foreign aid', 'aid program', 'alliance for progress', 'food for peace']],
  ['Latin America', ['latin america', 'latin american', 'dominican', 'brazil', 'argentina']],
  ['Africa', ['africa', 'angola', 'algeria', 'ghana', 'guinea', 'morocco', 'tunisia']],
  ['Middle East', ['middle east', 'near east', 'iran', 'iraq', 'israel', 'egypt', 'suez']],
  ['Asia', ['china', 'korea', 'india', 'pakistan', 'burma', 'cambodia', 'thailand']],
  ['United Nations', ['united nations', 'u.n.', 'security council']],
  ['Intelligence', ['cia', 'intelligence', 'central intelligence', 'covert']],
  ['Defense', ['defense', 'military', 'joint chiefs', 'mcnamara', 'paramilitary']],
  ['Diplomacy', ['rusk', 'department of state', 'secretary of state', 'ambassador']],
];

const foreignPolicyTerms = [
  ...topicRules.flatMap(([, terms]) => terms),
  'foreign affairs',
  'foreign policy',
  'foreign countries',
  'free world',
  'communist',
  'counter-guerrilla',
  'iron curtain',
  'state department',
  'department of state',
  'peace corps',
  'summit',
  'treaty',
];

const naraExclusionTerms = ['contracts to small business'];

const naraQueries = [
  { q: '1961', collectionIdentifier: 'JFK-3', label: 'President Office Files' },
  { q: '1961', collectionIdentifier: 'JFK-4', label: 'National Security Files' },
  { q: '1961', collectionIdentifier: 'JFK-8.25', label: 'Pierre Salinger Files' },
  { q: '"Bay of Pigs" 1961 Kennedy', label: 'NARA Bay of Pigs search' },
  { q: '"Laos" 1961 Kennedy', label: 'NARA Laos search' },
  { q: '"foreign aid" 1961 Kennedy', label: 'NARA foreign aid search' },
];

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function elementName(node) {
  return node?.localName || node?.nodeName?.split(':').pop() || '';
}

function isElement(node, name) {
  return node?.nodeType === 1 && elementName(node) === name;
}

function getAttr(node, name) {
  return node?.getAttribute?.(name) || '';
}

function childElements(node, name) {
  return Array.from(node?.childNodes || []).filter(
    (child) => child.nodeType === 1 && (!name || elementName(child) === name),
  );
}

function textWithoutNotes(node) {
  if (!node) return '';
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue || '';
  if (node.nodeType === 1 && elementName(node) === 'note') return '';
  return Array.from(node.childNodes || []).map(textWithoutNotes).join(' ');
}

function nodeText(node) {
  return normalizeText(textWithoutNotes(node));
}

function firstDirectChildText(node, tagName) {
  const child = childElements(node, tagName)[0];
  return child ? nodeText(child) : '';
}

function allElements(node, tagName) {
  const found = [];
  function visit(current) {
    if (current?.nodeType === 1 && (!tagName || elementName(current) === tagName)) {
      found.push(current);
    }
    for (const child of Array.from(current?.childNodes || [])) {
      visit(child);
    }
  }
  visit(node);
  return found;
}

function firstElement(node, tagName, predicate = () => true) {
  return allElements(node, tagName).find(predicate) || null;
}

function truncate(value, length = 320) {
  const text = normalizeText(value);
  if (text.length <= length) return text;
  const clipped = text.slice(0, length - 1);
  return `${clipped.slice(0, clipped.lastIndexOf(' ') || clipped.length)}...`;
}

function isoFromDateParts(year, month = 1, day = 1) {
  if (!year) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function parseLooseDate(text) {
  const months =
    '(January|February|March|April|May|June|July|August|September|October|November|December)';
  const match = normalizeText(text).match(new RegExp(`${months}\\s+(\\d{1,2}),\\s*(1961)`, 'i'));
  if (!match) return null;
  const month = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ].indexOf(match[1].toLowerCase()) + 1;
  return isoFromDateParts(match[3], month, match[2]);
}

function dateObjToIso(value, fallbackEnd = false) {
  if (!value?.year) return '';
  const month = value.month || (fallbackEnd ? 12 : 1);
  const day = value.day || (fallbackEnd ? lastDayOfMonth(value.year, month) : 1);
  return isoFromDateParts(
    value.year,
    month,
    day,
  );
}

function overlapsWindow(start, end = start) {
  if (!start) return false;
  const safeEnd = end || start;
  return safeEnd >= START_DATE && start <= END_DATE;
}

function formatDate(iso) {
  if (!iso) return 'Undated';
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function dayNumber(iso) {
  if (!iso) return null;
  const start = new Date(`${START_DATE}T00:00:00Z`);
  const date = new Date(`${iso}T00:00:00Z`);
  return Math.floor((date.getTime() - start.getTime()) / 86400000) + 1;
}

function getFrusDocumentDate(doc) {
  const dates = allElements(doc, 'date');
  for (const dateNode of dates) {
    const sourceType = getAttr(dateNode, 'type');
    if (sourceType === 'publication-date' || sourceType === 'content-date') continue;
    const when = getAttr(dateNode, 'when');
    const from = getAttr(dateNode, 'from') || getAttr(dateNode, 'notBefore');
    const to = getAttr(dateNode, 'to') || getAttr(dateNode, 'notAfter');
    if (when) return { start: when.slice(0, 10), end: when.slice(0, 10), display: nodeText(dateNode) };
    if (from || to) {
      const start = (from || to).slice(0, 10);
      const end = (to || from).slice(0, 10);
      return { start, end, display: nodeText(dateNode) };
    }
    const parsed = parseLooseDate(nodeText(dateNode));
    if (parsed) return { start: parsed, end: parsed, display: nodeText(dateNode) };
  }

  const parsedTitleDate = parseLooseDate(firstDirectChildText(doc, 'head'));
  if (parsedTitleDate) return { start: parsedTitleDate, end: parsedTitleDate, display: formatDate(parsedTitleDate) };
  return null;
}

function getParentSection(doc) {
  let current = doc.parentNode;
  while (current) {
    if (current.nodeType === 1 && elementName(current).startsWith('div')) {
      const head = firstDirectChildText(current, 'head');
      if (head) return head;
    }
    current = current.parentNode;
  }
  return '';
}

function getTopics(...values) {
  const haystack = values.filter(Boolean).join(' ').toLowerCase();
  const topics = topicRules
    .filter(([, terms]) => terms.some((term) => matchesTerm(haystack, term)))
    .map(([topic]) => topic);
  return topics.length ? [...new Set(topics)] : ['General'];
}

function looksForeignPolicy(...values) {
  const haystack = values.filter(Boolean).join(' ').toLowerCase();
  return foreignPolicyTerms.some((term) => matchesTerm(haystack, term));
}

function matchesTerm(haystack, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

function getFrusSnippet(doc) {
  const paragraph = allElements(doc, 'p')
    .map(nodeText)
    .find((text) => text.length > 80 && !/^source:/i.test(text));
  return truncate(paragraph || '', 300);
}

function getFrusSourceNote(doc) {
  const sourceNote = firstElement(
    doc,
    'note',
    (node) => getAttr(node, 'type') === 'source' || getAttr(node, 'n') === '0',
  );
  return truncate(nodeText(sourceNote), 360);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'jfk-first-90-days-builder' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    const text = await response.text();
    throw new Error(`Expected JSON from ${url}, got ${contentType}: ${text.slice(0, 80)}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/xml,text/xml,text/plain,*/*', 'user-agent': 'jfk-first-90-days-builder' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

async function buildFrusDocuments() {
  const tree = await fetchJson(FRUS_TREE_URL);
  const volumePaths = tree.tree
    .map((entry) => entry.path)
    .filter((path) => /^volumes\/frus1961-63.*\.xml$/.test(path))
    .sort();

  const documents = [];
  for (const volumePath of volumePaths) {
    const xml = await fetchText(`${FRUS_RAW_BASE}${volumePath}`);
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    const tei = dom.documentElement;
    const volumeId = getAttr(tei, 'xml:id') || basename(volumePath, '.xml');
    const completeTitle =
      allElements(tei, 'title').find((title) => getAttr(title, 'type') === 'complete') ||
      allElements(tei, 'title')[0];
    const volumeTitle = nodeText(completeTitle);
    const volumeShort =
      nodeText(allElements(tei, 'title').find((title) => getAttr(title, 'type') === 'volume')) ||
      volumeTitle.replace(/^Foreign Relations of the United States,\s*1961.?1963,\s*/i, '');
    const cover =
      firstElement(tei, 'ref', (node) => (getAttr(node, 'target') || '').includes('/covers/'))?.getAttribute(
        'target',
      ) || '';

    const divs = allElements(tei, null).filter(
      (node) => elementName(node).startsWith('div') && getAttr(node, 'type') === 'document',
    );

    for (const doc of divs) {
      const date = getFrusDocumentDate(doc);
      if (!date || !overlapsWindow(date.start, date.end)) continue;
      const docId = getAttr(doc, 'xml:id') || getAttr(doc, 'id');
      if (!docId) continue;
      const title = firstDirectChildText(doc, 'head');
      const section = getParentSection(doc);
      const sourceNote = getFrusSourceNote(doc);
      const summary = getFrusSnippet(doc);
      const documentNumber = title.match(/^(\d+)\./)?.[1] || docId.replace(/^d/, '');
      const documentType = /^(\d+\.\s*)?Editorial Note/i.test(title)
        ? 'FRUS editorial note'
        : 'FRUS primary document';
      const topics = getTopics(title, section, volumeTitle, sourceNote, summary);

      documents.push({
        id: `frus-${volumeId}-${docId}`,
        title,
        date: date.start,
        endDate: date.end,
        displayDate: date.display || formatDate(date.start),
        day: dayNumber(date.start),
        source: 'FRUS',
        repository: 'Office of the Historian, U.S. Department of State',
        collection: 'Foreign Relations of the United States',
        container: volumeShort,
        section,
        documentNumber,
        documentType,
        topics,
        url: `${FRUS_HTML_BASE}/${volumeId}/${docId}`,
        officialUrl: `${FRUS_HTML_BASE}/${volumeId}/${docId}`,
        dataUrl: `${FRUS_RAW_BASE}${volumePath}`,
        thumbnailUrl: cover,
        citation: `${volumeTitle}, Document ${documentNumber}`,
        summary,
        sourceNote,
      });
    }
    console.log(`FRUS ${volumeId}: ${documents.filter((doc) => doc.dataUrl.endsWith(volumePath)).length} matches`);
  }
  return documents;
}

function naraRecordText(record) {
  return normalizeText(
    [
      record.title,
      record.scopeAndContentNote,
      record.localIdentifier,
      record.subjects?.map((subject) => subject.heading).join(' '),
      record.ancestors?.map((ancestor) => ancestor.title).join(' '),
      record.contributors?.map((contributor) => contributor.heading).join(' '),
      record.creators?.map((creator) => creator.heading).join(' '),
    ].join(' '),
  );
}

function getNaraDateRange(record) {
  const titleDate = parseLooseDate(record.title);
  if (titleDate) return { start: titleDate, end: titleDate, precision: 'day', titleDate: true };

  const start =
    dateObjToIso(record.coverageStartDate) ||
    dateObjToIso(record.inclusiveStartDate) ||
    dateObjToIso(record.productionDates?.[0]);
  const end =
    dateObjToIso(record.coverageEndDate, true) ||
    dateObjToIso(record.inclusiveEndDate, true) ||
    dateObjToIso(record.productionDates?.[record.productionDates.length - 1], true) ||
    start;

  return { start, end, precision: start && /^\d{4}-01-01$/.test(start) ? 'year' : 'range', titleDate: false };
}

function isJfkRecord(record) {
  const haystack = [
    record.dataControlGroup?.groupName,
    record.localIdentifier,
    record.subjects?.map((subject) => subject.heading).join(' '),
    record.ancestors?.map((ancestor) => `${ancestor.collectionIdentifier || ''} ${ancestor.title || ''}`).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    haystack.includes('john f. kennedy') ||
    haystack.includes('kennedy library') ||
    haystack.includes('jfk-') ||
    /^jfk/i.test(record.localIdentifier || '')
  );
}

function getJfkUrl(localIdentifier) {
  if (!localIdentifier || !/^jfk/i.test(localIdentifier)) return '';
  return `${JFK_ASSET_BASE}/${localIdentifier.toLowerCase()}`;
}

function getDigitalObject(record) {
  const objects = record.digitalObjects || [];
  return (
    objects.find((object) => object.objectType?.includes('PDF')) ||
    objects.find((object) => object.objectType?.includes('Image')) ||
    objects[0] ||
    null
  );
}

function recordToArchiveDoc(record, queryLabel) {
  const range = getNaraDateRange(record);
  const text = naraRecordText(record);
  if (!isJfkRecord(record)) return null;
  if (!overlapsWindow(range.start, range.end)) return null;
  if (!range.titleDate && range.start < START_DATE && range.end > END_DATE) return null;
  if (naraExclusionTerms.some((term) => matchesTerm(text, term))) return null;
  if (!looksForeignPolicy(text)) return null;

  const localIdentifier = record.localIdentifier || '';
  const jfkUrl = getJfkUrl(localIdentifier);
  const digitalObject = getDigitalObject(record);
  const repository =
    record.dataControlGroup?.groupName === 'John F. Kennedy Library' || localIdentifier
      ? 'John F. Kennedy Presidential Library and Museum'
      : 'National Archives Catalog';
  const source = jfkUrl ? 'JFK Library' : 'NARA Catalog';
  const subjects = (record.subjects || []).map((subject) => subject.heading).filter(Boolean);
  const collection =
    record.ancestors?.find((ancestor) => ancestor.levelOfDescription === 'collection')?.title ||
    record.ancestors?.[0]?.title ||
    'National Archives Catalog';
  const container =
    record.ancestors?.find((ancestor) => ancestor.levelOfDescription === 'series')?.title ||
    record.ancestors?.[record.ancestors.length - 1]?.title ||
    queryLabel;

  return {
    id: `nara-${record.naId}`,
    title: normalizeText(record.title),
    date: range.start,
    endDate: range.end,
    displayDate: range.start === range.end ? formatDate(range.start) : `${formatDate(range.start)} - ${formatDate(range.end)}`,
    day: dayNumber(range.start),
    source,
    repository,
    collection,
    container,
    section: subjects.slice(0, 3).join(', '),
    documentNumber: String(record.naId),
    documentType: record.levelOfDescription === 'item' ? 'NARA item' : 'NARA file unit',
    topics: getTopics(text),
    url: jfkUrl || `${NARA_CATALOG_BASE}/${record.naId}`,
    officialUrl: `${NARA_CATALOG_BASE}/${record.naId}`,
    dataUrl: digitalObject?.objectUrl || '',
    thumbnailUrl: digitalObject?.objectType?.includes('Image') ? digitalObject.objectUrl : '',
    citation: `${collection}. ${normalizeText(record.title)}. NAID ${record.naId}.`,
    summary: truncate(record.scopeAndContentNote || subjects.join(', '), 320),
    sourceNote: record.useRestriction?.status
      ? `Use restriction: ${record.useRestriction.status}${record.useRestriction.note ? ` - ${truncate(record.useRestriction.note, 220)}` : ''}`
      : '',
  };
}

async function runNaraQuery(query) {
  const results = [];
  const seenIds = new Set();
  for (let page = 1; page <= 25; page += 1) {
    const params = new URLSearchParams({
      availableOnline: 'true',
      q: query.q,
      rows: '20',
      page: String(page),
    });
    if (query.collectionIdentifier) params.set('collectionIdentifier', query.collectionIdentifier);
    const data = await fetchJson(`${NARA_SEARCH_URL}?${params.toString()}`);
    const hits = data.body?.hits?.hits || [];
    if (!hits.length) break;
    for (const hit of hits) {
      const record = hit._source?.record;
      if (!record?.naId || seenIds.has(record.naId)) continue;
      seenIds.add(record.naId);
      results.push(record);
    }
    const total = data.body?.hits?.total?.value || 0;
    if (page * 20 >= total) break;
  }
  console.log(`NARA ${query.label}: ${results.length} fetched`);
  return results;
}

async function buildNaraDocuments() {
  const allRecords = [];
  for (const query of naraQueries) {
    allRecords.push(...(await runNaraQuery(query)));
  }

  const recordsById = new Map();
  for (const record of allRecords) {
    recordsById.set(record.naId, record);
  }

  return Array.from(recordsById.values())
    .map((record) => recordToArchiveDoc(record, 'NARA/JFK query'))
    .filter(Boolean);
}

function buildStats(documents) {
  const bySource = {};
  const byTopic = {};
  const byType = {};
  for (const doc of documents) {
    bySource[doc.source] = (bySource[doc.source] || 0) + 1;
    byType[doc.documentType] = (byType[doc.documentType] || 0) + 1;
    for (const topic of doc.topics) byTopic[topic] = (byTopic[topic] || 0) + 1;
  }
  return { bySource, byTopic, byType, total: documents.length };
}

function buildSupplementalDocuments() {
  return supplementalRecords
    .filter((record) => !record.date || overlapsWindow(record.date, record.endDate || record.date))
    .map((record) => {
      const date = record.date || '';
      const endDate = record.endDate || date;
      const text = [
        record.title,
        record.citation,
        record.summary,
        record.sourceNote,
        record.repository,
        record.collection,
        record.container,
        record.section,
      ].join(' ');

      return {
        id: record.id,
        title: normalizeText(record.title),
        date,
        endDate,
        displayDate:
          record.displayDate ||
          (date === endDate ? formatDate(date) : `${formatDate(date)} - ${formatDate(endDate)}`),
        day: dayNumber(date),
        source: record.source,
        repository: record.repository,
        collection: record.collection,
        container: record.container,
        section: record.section,
        documentNumber: record.documentNumber || '',
        documentType: record.documentType,
        topics: record.topics?.length ? record.topics : getTopics(text),
        url: record.url,
        officialUrl: record.officialUrl || record.url,
        dataUrl: record.dataUrl || '',
        thumbnailUrl: record.thumbnailUrl || '',
        citation: normalizeText(record.citation),
        summary: truncate(record.summary, 320),
        sourceNote: truncate(record.sourceNote, 360),
      };
    });
}

async function main() {
  const frus = await buildFrusDocuments();
  const nara = await buildNaraDocuments();
  const supplemental = buildSupplementalDocuments();
  const docsById = new Map();
  for (const doc of [...frus, ...nara, ...supplemental]) docsById.set(doc.id, doc);
  const documents = Array.from(docsById.values()).sort((a, b) => {
    const aDate = a.date || '9999-12-31';
    const bDate = b.date || '9999-12-31';
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.title.localeCompare(b.title);
  });

  const data = {
    metadata: {
      title: 'JFK First 90 Days',
      subtitle: 'Foreign policy primary-source index',
      generatedAt: new Date().toISOString(),
      windowStart: START_DATE,
      windowEnd: END_DATE,
      scopeNote:
        'Documents are included when their date metadata overlaps January 20 through April 20, 1961 and the record text matches foreign-policy topics. FRUS documents are extracted from official State Department TEI/XML; JFK Library/NARA records come from the National Archives Catalog proxy and link back to official asset or catalog pages. CIA FOIA, State FOIA, ISCAP, and National Security Archive records are curated from their release pages, search results, and Virtual Reading Room document pages, with direct PDF links where available. Nitze Interviews contains the four local PDF files selected from the Nitze OCR search because they discuss Kennedy foreign-policy work in the first 90 days.',
      sourceOrder: ['FRUS', 'JFK Library', 'NARA Catalog', 'CIA FOIA', 'State FOIA', 'ISCAP', 'National Security Archive', 'Nitze Interviews'],
      officialSources: [
        {
          label: 'FRUS Kennedy Administration volumes',
          url: 'https://history.state.gov/historicaldocuments/kennedy',
        },
        {
          label: 'HistoryAtState FRUS XML repository',
          url: 'https://github.com/HistoryAtState/frus',
        },
        {
          label: 'JFK Library Digital Archives',
          url: 'https://www.jfklibrary.org/archives',
        },
        {
          label: 'National Archives Catalog',
          url: 'https://catalog.archives.gov/',
        },
        {
          label: 'CIA FOIA Electronic Reading Room',
          url: 'https://www.cia.gov/readingroom/',
        },
        {
          label: 'CIA Current/Central Intelligence Bulletin Collection',
          url: 'https://www.cia.gov/readingroom/collection/currentcentral-intelligence-bulletin',
        },
        {
          label: 'CIA Bay of Pigs Release',
          url: 'https://www.cia.gov/readingroom/collection/bay-pigs-release',
        },
        {
          label: 'Department of State FOIA Library',
          url: 'https://foia.state.gov/FOIALIBRARY/SearchResults.aspx',
        },
        {
          label: 'Department of State FOIA microfiche releases',
          url: 'https://foia.state.gov/FOIALIBRARY/Microfiche2.aspx',
        },
        {
          label: 'ISCAP release 2014-030: Laos, 1961',
          url: 'https://www.archives.gov/declassification/iscap/pdf/2014-030',
        },
        {
          label: 'ISCAP releases',
          url: 'https://www.archives.gov/declassification/iscap/releases',
        },
        {
          label: 'National Security Archive Virtual Reading Room',
          url: 'https://nsarchive.gwu.edu/virtual-reading-room',
        },
        {
          label: 'National Security Archive Bay of Pigs release',
          url: 'https://nsarchive2.gwu.edu/bayofpigs/press3.html',
        },
        {
          label: 'Paul Nitze interview PDFs',
          url: '/jfk-first-90-days/documents/nitze/nitze-air-force-oral-history-to-page-308.pdf',
        },
      ],
    },
    stats: buildStats(documents),
    documents,
  };

  await mkdir('src/data', { recursive: true });
  await writeFile('src/data/archive.json', `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Wrote ${documents.length} records to src/data/archive.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
