async function runSearch() {
  const params = new URLSearchParams(window.location.search);
  const query = (params.get('q') || '').trim();
  const input = document.getElementById('site-search-input');
  if (input) input.value = query;
  const container = document.getElementById('search-results');
  if (!container || !query) return;
  container.textContent = 'Searching...';
  const response = await fetch('search-index.json');
  const index = await response.json();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
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
