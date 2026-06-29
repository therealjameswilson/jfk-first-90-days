import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/cuban-missile-nuclear-war');
const dataPath = path.join(root, 'data/documents.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const documents = data.documents;

const csvColumns = [
  'id',
  'date',
  'title',
  'originator',
  'source',
  'documentType',
  'classification',
  'category',
  'evidenceRole',
  'warQuestion',
  'summary',
  'repository',
  'citation',
  'sourceNote',
  'url',
  'scanUrl',
  'ocrUrl',
  'status',
  'tags',
];

const csv = [
  csvColumns.join(','),
  ...documents.map((document) =>
    csvColumns.map((column) => csvCell(column === 'tags' ? document.tags.join('; ') : document[column] ?? '')).join(','),
  ),
].join('\n');

fs.writeFileSync(path.join(root, 'data/documents.csv'), `${csv}\n`);

const grouped = new Map();
for (const document of documents) {
  if (!grouped.has(document.category)) grouped.set(document.category, []);
  grouped.get(document.category).push(document);
}

const markdown = [
  `# ${data.metadata.title}`,
  '',
  data.metadata.scopeNote,
  '',
  `Coverage note: ${data.metadata.coverageNote}`,
  '',
  `Generated: ${data.metadata.generatedAt}`,
  '',
  '## Source Categories',
  '',
  ...data.metadata.officialSources.map((source) => `- [${source.label}](${source.url})`),
  '',
  ...[...grouped.entries()].flatMap(([category, docs]) => [
    `## ${category}`,
    '',
    ...docs.flatMap((document) => [
      `### ${document.displayDate}: ${document.title}`,
      '',
      `- Originator: ${document.originator}`,
      `- Source: ${document.source}`,
      `- Status: ${document.status}`,
      `- Evidence role: ${document.evidenceRole}`,
      `- War question: ${document.warQuestion}`,
      `- Summary: ${document.summary}`,
      `- Citation: ${document.citation}`,
      `- Source note: ${document.sourceNote}`,
      `- Record: ${document.url || 'not available'}`,
      `- Scan: ${document.scanUrl || 'not available'}`,
      document.ocrUrl ? `- OCR: ${document.ocrUrl}` : '',
      `- Tags: ${document.tags.join(', ')}`,
      '',
    ].filter(Boolean)),
  ]),
].join('\n');

fs.writeFileSync(path.join(root, 'data/source-register.md'), `${markdown}\n`);

console.log(`Wrote ${documents.length} records to CSV and Markdown exports.`);

function csvCell(value) {
  const text = String(value).replaceAll('"', '""');
  return /[",\n]/.test(text) ? `"${text}"` : text;
}
