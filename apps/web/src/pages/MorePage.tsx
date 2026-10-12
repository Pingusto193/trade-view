import { Link } from 'react-router-dom';

const ITEMS = [
  {
    to: '/fontes',
    icon: '🛰️',
    label: 'Fontes de dados',
    desc: 'De onde vêm os preços, atrasos e limitações',
  },
  { to: '/conta', icon: '👤', label: 'Conta', desc: 'Senha, verificação em duas etapas, convites' },
  { to: '/instalar', icon: '📲', label: 'Instalar o app', desc: 'iPhone e computador' },
  { to: '/sobre', icon: 'ℹ️', label: 'Sobre e avisos', desc: 'Riscos, créditos e licenças' },
];

/** Menu "Mais" do celular (a barra de baixo só tem as telas principais). */
export function MorePage() {
  return (
    <ul className="mx-auto max-w-xl divide-y divide-line p-2">
      {ITEMS.map((i) => (
        <li key={i.to}>
          <Link to={i.to} className="flex items-center gap-3 px-2 py-3 hover:bg-panel-2">
            <span className="text-xl" aria-hidden>
              {i.icon}
            </span>
            <span>
              <span className="block font-medium">{i.label}</span>
              <span className="block text-xs text-muted">{i.desc}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
