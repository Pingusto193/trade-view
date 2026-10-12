import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CdiBox } from '../components/CdiBox';
import { LIBRARY_GROUPS, libraryPath } from '../library/catalog';
import { Markdown } from '../library/Markdown';
import { getPage, isLibrarySlug } from '../library/pages';

const CATEGORY_LABEL: Record<string, string> = {
  setup: 'Setup',
  indicador: 'Indicador',
  conceito: 'Conceito',
  aviso: 'Aviso importante',
};

/** Página da Biblioteca → setup do laboratório (para o botão "testar"). */
const LAB_SETUP: Record<string, string> = {
  'setup-9-1': 's91',
  'setup-9-2': 's92',
  'setup-9-3': 's93',
  'recuo-a-media': 'pullback',
  'rompimento-consolidacao': 'consolidation',
  elastico: 'elastic',
  reflexividade: 'reflexivity',
};

/** Blocos automáticos que substituem os marcadores das páginas. */
function markersFor(slug: string) {
  const setup = LAB_SETUP[slug];
  return {
    laboratorio: (
      <div
        role="note"
        className="my-3 rounded border border-line bg-panel-2 px-3 py-2 text-sm"
        data-testid="lab-results"
      >
        <p className="font-semibold">Resultados medidos no laboratório</p>
        <p className="mt-1 text-muted">
          Os números deste setup dependem do ativo, do tempo gráfico e do período: teste no
          laboratório com os candles reais da fonte, custos, imposto de renda e comparação com o CDI
          e com o comprar-e-segurar. As ocorrências do painel de Setups do gráfico <b>não</b> são
          backtest: não têm custos, impostos nem amostra suficiente.
        </p>
        <Link
          to={setup ? `/laboratorio?setup=${setup}` : '/laboratorio'}
          className="mt-2 inline-block rounded border border-accent px-2 py-1 text-accent"
        >
          🧪 Testar no laboratório
        </Link>
      </div>
    ),
    cdi: <CdiBox />,
  };
}

function Index() {
  const [q, setQ] = useState('');
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const groups = useMemo(
    () =>
      LIBRARY_GROUPS.map((g) => ({
        title: g.title,
        items: g.slugs
          .map((slug) => ({ slug, page: getPage(slug) }))
          .filter(
            (x) =>
              x.page &&
              (!q || norm(`${x.page.meta.titulo} ${x.page.meta.resumo}`).includes(norm(q.trim()))),
          ),
      })).filter((g) => g.items.length > 0),
    [q],
  );
  return (
    <div className="mx-auto max-w-3xl p-3">
      <h1 className="text-xl font-semibold">Biblioteca</h1>
      <p className="mt-1 text-sm text-muted">
        As regras exatas de cada setup e indicador como o Radar calcula, de onde vieram, quando
        falham e as críticas. Nada aqui é recomendação de investimento.
      </p>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar (ex.: ADX, stop, volume)"
        aria-label="Buscar na Biblioteca"
        className="mt-3 w-full rounded border border-line bg-panel px-3 py-2 text-sm"
      />
      {groups.length === 0 && <p className="mt-4 text-sm text-muted">Nada encontrado.</p>}
      {groups.map((g) => (
        <section key={g.title} className="mt-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {g.title}
          </h2>
          <ul className="divide-y divide-line rounded border border-line">
            {g.items.map(({ slug, page }) => (
              <li key={slug}>
                <Link to={libraryPath(slug)} className="block px-3 py-2 hover:bg-panel-2">
                  <span className="block text-sm font-medium">{page!.meta.titulo}</span>
                  <span className="block text-xs text-muted">{page!.meta.resumo}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PageView({ slug }: { slug: string }) {
  const page = isLibrarySlug(slug) ? getPage(slug) : null;
  const loc = useLocation();
  useEffect(() => {
    const id = decodeURIComponent(loc.hash.replace('#', ''));
    if (id) document.getElementById(id)?.scrollIntoView();
    else document.querySelector('main')?.scrollTo(0, 0);
  }, [slug, loc.hash]);

  if (!page) {
    return (
      <div className="mx-auto max-w-3xl p-3 text-sm">
        <p>Página não encontrada.</p>
        <Link to="/biblioteca" className="text-accent underline">
          Voltar para a Biblioteca
        </Link>
      </div>
    );
  }
  const toc = page.blocks.filter((b) => b.t === 'h2');
  return (
    <article className="mx-auto max-w-3xl p-3 pb-10">
      <Link to="/biblioteca" className="text-xs text-accent">
        ← Biblioteca
      </Link>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {CATEGORY_LABEL[page.meta.categoria] ?? page.meta.categoria}
      </p>
      <h1 className="text-2xl font-semibold">{page.meta.titulo}</h1>
      <p className="mt-1 text-muted">{page.meta.resumo}</p>
      {toc.length > 2 && (
        <nav aria-label="Nesta página" className="mt-3 flex flex-wrap gap-1 text-xs">
          {toc.map((h) =>
            h.t === 'h2' ? (
              <a
                key={h.id}
                href={`#${h.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="rounded border border-line px-2 py-0.5 text-muted hover:text-text"
              >
                {h.text}
              </a>
            ) : null,
          )}
        </nav>
      )}
      <div className="mt-2 text-[15px]">
        <Markdown blocks={page.blocks} markers={markersFor(slug)} />
      </div>
      {page.meta.relacionados.length > 0 && (
        <section className="mt-8 border-t border-line pt-3">
          <h2 className="text-sm font-semibold">Veja também</h2>
          <ul className="mt-1 flex flex-wrap gap-2 text-sm">
            {page.meta.relacionados.filter(isLibrarySlug).map((r) => (
              <li key={r}>
                <Link to={libraryPath(r)} className="text-accent underline underline-offset-2">
                  {getPage(r)?.meta.titulo ?? r}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** Biblioteca (SPEC §16): índice com busca e páginas em Markdown restrito. */
export default function LibraryPage() {
  const { slug } = useParams();
  return slug ? <PageView slug={slug} /> : <Index />;
}
