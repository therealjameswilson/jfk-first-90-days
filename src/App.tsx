import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Archive,
  BookOpen,
  CalendarDays,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Globe2,
  Library,
  Link as LinkIcon,
  Search,
  Shield,
  X,
} from 'lucide-react';
import archiveJson from './data/archive.json';
import type { ArchiveData, ArchiveDocument, ArchiveSource } from './types';
import './App.css';

const archive = archiveJson as ArchiveData;
const allSources = ['All', ...archive.metadata.sourceOrder] as const;
const START = new Date(`${archive.metadata.windowStart}T00:00:00Z`);
const WEEK_COUNT = 14;
const PAGE_SIZE = 90;

type SourceFilter = (typeof allSources)[number];

function App() {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SourceFilter>('All');
  const [topic, setTopic] = useState('All');
  const [type, setType] = useState('All');
  const [week, setWeek] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const topics = useMemo(() => {
    return Object.entries(archive.stats.byTopic)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, []);

  const documentTypes = useMemo(() => Object.keys(archive.stats.byType).sort(), []);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const queryTerms = normalizedQuery ? normalizedQuery.split(/\s+/) : [];
    return archive.documents.filter((document) => {
      if (source !== 'All' && document.source !== source) return false;
      if (topic !== 'All' && !document.topics.includes(topic)) return false;
      if (type !== 'All' && document.documentType !== type) return false;
      if (week !== null && getWeekIndex(document.day) !== week) return false;
      if (!queryTerms.length) return true;
      const haystack = [
        document.title,
        document.citation,
        document.summary,
        document.sourceNote,
        document.repository,
        document.collection,
        document.container,
        document.section,
        document.topics.join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return queryTerms.every((term) => haystack.includes(term));
    });
  }, [query, source, topic, type, week]);

  const timeline = useMemo(() => buildTimeline(filtered), [filtered]);
  const sourceMetrics = useMemo(() => {
    return [
      ...archive.metadata.sourceOrder.map((sourceName) => ({
        icon: sourceIcon(sourceName),
        label: sourceName === 'NARA Catalog' ? 'NARA' : sourceName,
        value: archive.stats.bySource[sourceName] || 0,
      })),
      { icon: <Database />, label: 'Total', value: archive.stats.total },
    ];
  }, []);
  const visibleDocuments = filtered.slice(0, visibleCount);
  const hasFilters =
    query || source !== 'All' || topic !== 'All' || type !== 'All' || week !== null;
  const heroImages = useMemo(() => getHeroImages(archive.documents), []);

  function clearFilters() {
    setQuery('');
    setSource('All');
    setTopic('All');
    setType('All');
    setWeek(null);
    setVisibleCount(PAGE_SIZE);
  }

  function updateSource(nextSource: SourceFilter) {
    setSource(nextSource);
    setVisibleCount(PAGE_SIZE);
  }

  function updateTopic(nextTopic: string) {
    setTopic(nextTopic);
    setVisibleCount(PAGE_SIZE);
  }

  function updateType(nextType: string) {
    setType(nextType);
    setVisibleCount(PAGE_SIZE);
  }

  function updateWeek(nextWeek: number) {
    setWeek((current) => (current === nextWeek ? null : nextWeek));
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead__copy">
          <p className="eyebrow">Foreign policy primary sources</p>
          <h1>JFK First 90 Days</h1>
          <p className="lede">
            January 20 through April 20, 1961, indexed from FRUS first, then JFK
            Library, NARA, ISCAP, and National Security Archive records.
          </p>
        </div>
        <div className="source-mosaic" aria-label="Official source images">
          {heroImages.map((image) => (
            <img key={image} src={image} alt="" />
          ))}
        </div>
      </header>

      <section className="metrics" aria-label="Corpus totals">
        {sourceMetrics.map((metric) => (
          <Metric key={metric.label} icon={metric.icon} label={metric.label} value={metric.value} />
        ))}
      </section>

      <section className="workbench">
        <aside className="filters" aria-label="Archive filters">
          <div className="searchbox">
            <Search aria-hidden="true" size={18} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder="Search Cuba, Laos, Rusk..."
              aria-label="Search archive"
            />
          </div>

          <div className="filter-block">
            <div className="filter-heading">
              <Shield size={16} aria-hidden="true" />
              Source
            </div>
            <div className="segmented" role="group" aria-label="Source">
              {allSources.map((option) => (
                <button
                  type="button"
                  key={option}
                  className={source === option ? 'is-active' : ''}
                  onClick={() => updateSource(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <label className="select-label">
            <span>
              <Filter size={16} aria-hidden="true" />
              Topic
            </span>
            <select value={topic} onChange={(event) => updateTopic(event.target.value)}>
              <option>All</option>
              {topics.map((topicName) => (
                <option key={topicName}>{topicName}</option>
              ))}
            </select>
          </label>

          <label className="select-label">
            <span>
              <FileText size={16} aria-hidden="true" />
              Type
            </span>
            <select value={type} onChange={(event) => updateType(event.target.value)}>
              <option>All</option>
              {documentTypes.map((documentType) => (
                <option key={documentType}>{documentType}</option>
              ))}
            </select>
          </label>

          <div className="timeline-panel">
            <div className="filter-heading">
              <CalendarDays size={16} aria-hidden="true" />
              Timeline
            </div>
            <div className="timeline" aria-label="Documents by week">
              {timeline.map((bucket) => (
                <button
                  type="button"
                  key={bucket.index}
                  className={week === bucket.index ? 'is-active' : ''}
                  style={{ '--bar-height': `${bucket.height}%` } as CSSProperties}
                  onClick={() => updateWeek(bucket.index)}
                  title={`${bucket.label}: ${bucket.count} records`}
                  aria-label={`${bucket.label}: ${bucket.count} records`}
                >
                  <span />
                </button>
              ))}
            </div>
          </div>

          {hasFilters ? (
            <button type="button" className="clear-button" onClick={clearFilters}>
              <X size={16} aria-hidden="true" />
              Clear filters
            </button>
          ) : null}
        </aside>

        <section className="results" aria-label="Document results">
          <div className="results__header">
            <div>
              <p className="eyebrow">Showing {filtered.length.toLocaleString()} records</p>
              <h2>Primary-source index</h2>
            </div>
            <a className="source-link" href={archive.metadata.officialSources[0].url} target="_blank">
              FRUS Kennedy volumes
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          </div>

          <div className="document-list">
            {visibleDocuments.map((document) => (
              <DocumentCard key={document.id} document={document} />
            ))}
          </div>

          {visibleCount < filtered.length ? (
            <button
              type="button"
              className="load-more"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              Show {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
            </button>
          ) : null}
        </section>
      </section>

      <footer className="source-notes">
        <p>{archive.metadata.scopeNote}</p>
        <div>
          {archive.metadata.officialSources.map((sourceLink) => (
            <a key={sourceLink.url} href={sourceLink.url} target="_blank">
              <LinkIcon size={15} aria-hidden="true" />
              {sourceLink.label}
            </a>
          ))}
        </div>
      </footer>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="metric">
      <span>{icon}</span>
      <strong>{value.toLocaleString()}</strong>
      <p>{label}</p>
    </div>
  );
}

function DocumentCard({ document }: { document: ArchiveDocument }) {
  return (
    <article className="document-card">
      <div className="document-card__meta">
        <span className={`source-chip source-chip--${sourceClass(document.source)}`}>
          {document.source}
        </span>
        <span>{document.displayDate}</span>
        {document.day ? <span>Day {document.day}</span> : null}
      </div>

      <h3>{document.title}</h3>

      <div className="topic-row">
        {document.topics.slice(0, 4).map((topic) => (
          <span key={topic}>{topic}</span>
        ))}
      </div>

      <p className="citation">{document.citation}</p>
      {document.summary ? <p className="summary">{document.summary}</p> : null}
      {document.sourceNote ? <p className="source-note">{document.sourceNote}</p> : null}

      <div className="document-card__footer">
        <span>{document.container}</span>
        <div>
          {document.dataUrl ? (
            <a href={document.dataUrl} target="_blank" aria-label={`Open data for ${document.title}`}>
              <Database size={16} aria-hidden="true" />
              Data
            </a>
          ) : null}
          <a href={document.url} target="_blank" aria-label={`Open official record for ${document.title}`}>
            <ExternalLink size={16} aria-hidden="true" />
            Official record
          </a>
        </div>
      </div>
    </article>
  );
}

function getWeekIndex(day: number | null) {
  if (!day) return null;
  return Math.max(0, Math.min(WEEK_COUNT - 1, Math.floor((day - 1) / 7)));
}

function buildTimeline(documents: ArchiveDocument[]) {
  const counts = Array.from({ length: WEEK_COUNT }, (_, index) => ({
    index,
    count: 0,
    label: formatWeekLabel(index),
    height: 8,
  }));
  for (const document of documents) {
    const index = getWeekIndex(document.day);
    if (index !== null) counts[index].count += 1;
  }
  const maxCount = Math.max(...counts.map((bucket) => bucket.count), 1);
  return counts.map((bucket) => ({
    ...bucket,
    height: bucket.count ? Math.max(12, Math.round((bucket.count / maxCount) * 100)) : 8,
  }));
}

function formatWeekLabel(index: number) {
  const date = new Date(START);
  date.setUTCDate(START.getUTCDate() + index * 7);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function sourceClass(sourceName: ArchiveSource) {
  return sourceName.toLowerCase().replace(/\s+/g, '-');
}

function sourceIcon(sourceName: ArchiveSource) {
  if (sourceName === 'FRUS') return <BookOpen />;
  if (sourceName === 'JFK Library') return <Library />;
  if (sourceName === 'NARA Catalog') return <Archive />;
  if (sourceName === 'ISCAP') return <Shield />;
  return <Globe2 />;
}

function getHeroImages(documents: ArchiveDocument[]) {
  const seen = new Set<string>();
  const images: string[] = [];
  for (const document of documents) {
    if (!document.thumbnailUrl || seen.has(document.thumbnailUrl)) continue;
    seen.add(document.thumbnailUrl);
    images.push(document.thumbnailUrl);
    if (images.length === 4) break;
  }
  return images;
}

export default App;
