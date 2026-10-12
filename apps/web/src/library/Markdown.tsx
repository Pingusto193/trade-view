import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { parseInline, type Block, type Inline } from './markdown';

function renderInline(xs: Inline[]): ReactNode {
  return xs.map((x, i) => {
    switch (x.t) {
      case 'text':
        return <Fragment key={i}>{x.v}</Fragment>;
      case 'b':
        return <strong key={i}>{renderInline(x.c)}</strong>;
      case 'i':
        return <em key={i}>{renderInline(x.c)}</em>;
      case 'code':
        return (
          <code key={i} className="rounded bg-panel-2 px-1 text-[0.9em]">
            {x.v}
          </code>
        );
      case 'link':
        return x.href.startsWith('/') ? (
          <Link key={i} to={x.href} className="text-accent underline underline-offset-2">
            {renderInline(x.c)}
          </Link>
        ) : (
          <a
            key={i}
            href={x.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2"
          >
            {renderInline(x.c)}
            <span aria-hidden> ↗</span>
          </a>
        );
    }
  });
}

export const Inl = ({ text }: { text: string }) => <>{renderInline(parseInline(text))}</>;

/** Desenha os blocos de uma página. Marcadores ([[laboratorio]], [[cdi]]) vêm de `markers`. */
export function Markdown({
  blocks,
  markers,
}: {
  blocks: Block[];
  markers: Record<string, ReactNode>;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h2':
            return (
              <h2 key={i} id={b.id} className="mb-2 mt-6 scroll-mt-4 text-lg font-semibold">
                {b.text}
              </h2>
            );
          case 'h3':
            return (
              <h3 key={i} id={b.id} className="mb-1 mt-4 scroll-mt-4 font-semibold">
                {b.text}
              </h3>
            );
          case 'p':
            return (
              <p key={i} className="my-2 leading-relaxed">
                <Inl text={b.text} />
              </p>
            );
          case 'ul':
          case 'ol': {
            const Tag = b.t;
            return (
              <Tag
                key={i}
                className={`my-2 space-y-1 pl-5 leading-relaxed ${b.t === 'ul' ? 'list-disc' : 'list-decimal'}`}
              >
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inl text={it} />
                  </li>
                ))}
              </Tag>
            );
          }
          case 'quote':
            return (
              <div
                key={i}
                role="note"
                className="my-3 rounded border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm"
              >
                {b.paras.map((p, j) => (
                  <p key={j} className="my-1 leading-relaxed">
                    <Inl text={p} />
                  </p>
                ))}
              </div>
            );
          case 'table':
            return (
              <div key={i} className="my-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j} className="border-b border-line px-2 py-1 text-left">
                          <Inl text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} className="border-b border-line/50 px-2 py-1 align-top">
                            <Inl text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'marker':
            return <Fragment key={i}>{markers[b.name] ?? null}</Fragment>;
        }
      })}
    </>
  );
}
