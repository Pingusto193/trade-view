import { LIBRARY_SLUGS, type LibrarySlug } from './catalog';
import { parsePage, type ParsedPage } from './markdown';

// Conteúdo das páginas (texto puro, embutido no pedaço de código da Biblioteca, carregado sob demanda).
const RAW = import.meta.glob<string>('./pages/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const cache = new Map<string, ParsedPage>();

export function rawPages(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, raw] of Object.entries(RAW)) {
    out[path.replace('./pages/', '').replace(/\.md$/, '')] = raw;
  }
  return out;
}

export function getPage(slug: string): ParsedPage | null {
  const hit = cache.get(slug);
  if (hit) return hit;
  const raw = RAW[`./pages/${slug}.md`];
  if (raw === undefined) return null;
  const page = parsePage(raw);
  cache.set(slug, page);
  return page;
}

export function isLibrarySlug(s: string): s is LibrarySlug {
  return (LIBRARY_SLUGS as readonly string[]).includes(s);
}
