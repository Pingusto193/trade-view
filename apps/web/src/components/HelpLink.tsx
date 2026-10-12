import { Link } from 'react-router-dom';
import { libraryPath, type LibrarySlug } from '../library/catalog';

/** Botão "?" que abre a página certa da Biblioteca (SPEC §16). */
export function HelpLink({
  slug,
  anchor,
  label,
  className = '',
}: {
  slug: LibrarySlug;
  anchor?: string;
  /** Texto para leitores de tela, ex.: "Ajuda: ADX". */
  label: string;
  className?: string;
}) {
  return (
    <Link
      to={libraryPath(slug, anchor)}
      aria-label={label}
      title={label}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line text-[10px] leading-none text-muted hover:border-accent hover:text-accent ${className}`}
    >
      ?
    </Link>
  );
}
