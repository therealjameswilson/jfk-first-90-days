# JFK First 90 Days

An interactive archive site for John F. Kennedy foreign-policy primary sources from January 20 through April 20, 1961.

The corpus starts with the State Department's official FRUS Kennedy administration volumes and supplements, then adds JFK Library, National Archives Catalog, DOD History, JCS History, GovInfo Public Papers, FOIA, ISCAP, and National Security Archive records that overlap the same date window and match foreign-policy topics.

## Sources

- FRUS Kennedy administration volumes: https://history.state.gov/historicaldocuments/kennedy
- HistoryAtState FRUS XML repository: https://github.com/HistoryAtState/frus
- JFK Library Digital Archives: https://www.jfklibrary.org/archives
- JFK Library press conferences: https://www.jfklibrary.org/archives/other-resources/john-f-kennedy-press-conferences
- JFK Library speeches: https://www.jfklibrary.org/archives/other-resources/john-f-kennedy-speeches
- National Archives Catalog: https://catalog.archives.gov/
- NARA Berlin Crisis of 1961 documents: https://www.archives.gov/research/foreign-policy/cold-war/1961-berlin-crisis/nara-documents.html
- DOD Historical Office: https://history.defense.gov/
- DOD Secretary of Defense Historical Series: https://history.defense.gov/Publications/Secretary-of-Defense-Historical-Series/
- DOD oral history transcripts: https://history.defense.gov/DOD-History/Oral-History/
- JCS Joint Staff History: https://www.jcs.mil/About/Joint-Staff-History/
- JCS and National Policy, Vol. VIII, 1961-1964 PDF: https://www.jcs.mil/Portals/36/Documents/History/Policy/Policy_V008.pdf
- GovInfo Public Papers of the Presidents, Kennedy 1961 Book 1: https://www.govinfo.gov/app/details/PPP-1961-book1/summary
- GovInfo PPP 1961 Book 1 PDF: https://www.govinfo.gov/content/pkg/PPP-1961-book1/pdf/PPP-1961-book1.pdf
- CIA FOIA Electronic Reading Room: https://www.cia.gov/readingroom/
- CIA Current/Central Intelligence Bulletin Collection: https://www.cia.gov/readingroom/collection/currentcentral-intelligence-bulletin
- CIA Bay of Pigs Release: https://www.cia.gov/readingroom/collection/bay-pigs-release
- Department of State FOIA Library: https://foia.state.gov/FOIALIBRARY/SearchResults.aspx
- Department of State FOIA microfiche releases: https://foia.state.gov/FOIALIBRARY/Microfiche2.aspx
- ISCAP release 2014-030, Laos 1961: https://www.archives.gov/declassification/iscap/pdf/2014-030
- ISCAP releases: https://www.archives.gov/declassification/iscap/releases
- National Security Archive Virtual Reading Room: https://nsarchive.gwu.edu/virtual-reading-room
- National Security Archive Bay of Pigs release: https://nsarchive2.gwu.edu/bayofpigs/press3.html
- Paul Nitze interview PDFs: local OCR-selected copies in `public/documents/nitze/`

## Commands

```bash
npm install
npm run build:data
npm run dev
npm run build
npm run lint
```

`npm run build:data` regenerates `src/data/archive.json` from official FRUS XML, NARA Catalog records, curated DOD History/JCS History/GovInfo PPP/CIA FOIA/State FOIA/ISCAP/National Security Archive source files, and the selected Nitze interview PDFs.

Citations are normalized during data generation into a trade nonfiction notes format: issuing body or author, quoted document title, collection or volume, locator, and date.
