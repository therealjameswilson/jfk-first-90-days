export type ArchiveSource =
  | 'FRUS'
  | 'JFK Library'
  | 'NARA Catalog'
  | 'DOD History'
  | 'CIA FOIA'
  | 'State FOIA'
  | 'ISCAP'
  | 'National Security Archive'
  | 'Nitze Interviews';

export interface ArchiveDocument {
  id: string;
  title: string;
  date: string;
  endDate: string;
  displayDate: string;
  day: number | null;
  source: ArchiveSource;
  repository: string;
  collection: string;
  container: string;
  section: string;
  documentNumber: string;
  documentType: string;
  topics: string[];
  url: string;
  officialUrl: string;
  dataUrl: string;
  thumbnailUrl: string;
  citation: string;
  summary: string;
  sourceNote: string;
}

export interface ArchiveData {
  metadata: {
    title: string;
    subtitle: string;
    generatedAt: string;
    windowStart: string;
    windowEnd: string;
    scopeNote: string;
    sourceOrder: ArchiveSource[];
    officialSources: Array<{ label: string; url: string }>;
  };
  stats: {
    bySource: Record<string, number>;
    byTopic: Record<string, number>;
    byType: Record<string, number>;
    total: number;
  };
  documents: ArchiveDocument[];
}
