import { Link } from 'react-router-dom';

const ITEMS = [
  {
    to: '/diario',
    icon: '📓',
    label: 'Diário real',
    desc: 'Trades feitos na sua corretora, com estatísticas, IR estimado e comparação com o treino',
  },
  { to: '/treino', icon: '🎯', label: 'Treino', desc: 'Conta fictícia com preços reais' },
  {
    to: '/replay',
    icon: '⏪',
    label: 'Replay',
    desc: 'Treine no passado, candle a candle, com ativo e data sorteados',
  },
  {
    to: '/calculadora',
    icon: '🧮',
    label: 'Calculadora de posição',
    desc: 'Quantidade pelo risco: ações, minicontratos, EUA, cripto e forex',
  },
  {
    to: '/scanner',
    icon: '📡',
    label: 'Scanner',
    desc: 'Onde há setup armado agora, nas suas listas e nos conjuntos sugeridos',
  },
  {
    to: '/laboratorio',
    icon: '🧪',
    label: 'Laboratório',
    desc: 'Teste setups no passado real, com custos, IR e comparação com o CDI',
  },
  {
    to: '/laboratorio/experimentos',
    icon: '🔬',
    label: 'Verificar o youtuber',
    desc: 'Experimentos prontos (E1–E7) com hipótese, método, resultado e limitações',
  },
  {
    to: '/setups/parametros',
    icon: '🎛️',
    label: 'Parâmetros dos setups',
    desc: 'Alvo, stop e filtros de cada setup (com aviso contra ajustar demais)',
  },
  {
    to: '/brasil',
    icon: '🇧🇷',
    label: 'Brasil: CDI, Selic e IR',
    desc: 'Juros atuais do Banco Central e seu treino comparado ao CDI',
  },
  {
    to: '/biblioteca',
    icon: '📚',
    label: 'Biblioteca',
    desc: 'Regras exatas dos setups, indicadores, riscos e críticas',
  },
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
