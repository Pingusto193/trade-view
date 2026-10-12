# Guia: rodar o Radar no seu computador

Este guia é para quem **nunca programou**. Siga na ordem. Se algo der errado, anote a mensagem de erro
exatamente como aparece.

Funciona no Windows, no Mac e no Linux. Tempo estimado: 20 a 30 minutos na primeira vez.

---

## 1. Instalar o Node.js (o "motor" que roda o Radar)

1. Acesse **https://nodejs.org** e baixe a versão **LTS** (a recomendada). Precisa ser a **22 ou mais nova**.
2. Instale clicando em "Próximo" até o fim (no Windows, deixe marcada a opção que instala as ferramentas
   adicionais, se aparecer).
3. Abra o **Terminal**:
   - Windows: tecla Windows → digite `PowerShell` → Enter.
   - Mac: Cmd + Espaço → digite `Terminal` → Enter.
4. Digite e aperte Enter:

   ```
   node --version
   ```

   Deve aparecer algo como `v22.12.0` ou maior. Se aparecer "comando não encontrado", feche e abra o
   terminal de novo; se continuar, reinstale o Node.

## 2. Ativar o pnpm (o gerenciador de pacotes do projeto)

No terminal:

```
corepack enable
pnpm --version
```

Deve aparecer um número de versão (ex.: `10.28.0`). No Windows, se der erro de permissão, abra o PowerShell
como administrador (botão direito → "Executar como administrador") e repita.

## 3. Baixar o código do Radar

**Opção fácil (sem Git):** no GitHub, abra o repositório do Radar → botão verde **Code** → **Download ZIP**.
Descompacte numa pasta fácil, por exemplo `Documentos\radar`.

**Opção com Git:** `git clone <endereço do seu repositório>`.

No terminal, entre na pasta (troque pelo caminho certo):

```
cd Documentos/radar
```

## 4. Instalar as dependências

```
pnpm install
```

Demora alguns minutos na primeira vez. Avisos amarelos (`WARN`) são normais. Se aparecer `ERR!` em vermelho,
copie a mensagem.

> No Windows, o banco de dados (better-sqlite3) normalmente já vem pronto. Se der erro mencionando
> `node-gyp` ou `Visual Studio`, instale as "Ferramentas de Build do Visual Studio" (opção "Desenvolvimento para
> desktop com C++") e rode `pnpm install` de novo.

## 5. Criar o arquivo de configuração

```
cp .env.example .env
```

No Windows (PowerShell), se o comando acima não funcionar: `copy .env.example .env`.

Abra o arquivo `.env` num editor de texto (Bloco de Notas serve). Por enquanto você não precisa mudar nada.
Mais tarde você vai colocar ali as chaves das fontes de dados (veja `docs/DATA_SOURCES.md`).

- **Sem internet ou só para testar a tela?** Troque `RADAR_SIMULATED=0` por `RADAR_SIMULATED=1`. Aparecem
  ativos "SIM…" com dados **simulados** (sempre marcados com uma faixa laranja "DADOS SIMULADOS").

## 6. Ligar o Radar

```
pnpm dev
```

Espere aparecer `Local: http://localhost:5173/`. Abra esse endereço no navegador (Chrome ou Edge).

Para desligar: volte ao terminal e aperte **Ctrl + C**.

## 7. Primeiro uso

- O gráfico inicial é o **BTCUSDT** (Binance), que funciona sem chave nenhuma.
- Toque em 🔎 para buscar outros ativos.
- O selo no canto superior direito do gráfico mostra **de onde vem o dado**, o **atraso** e se o volume é
  completo. Toque nele para ver detalhes e o horário do último dado válido.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `pnpm: command not found` | Rode `corepack enable` de novo; feche e abra o terminal. |
| Porta em uso (`EADDRINUSE`) | Outro Radar já está ligado. Feche o outro terminal ou reinicie o computador. |
| Gráfico vazio com "Erro na fonte" | A fonte de dados está fora do ar ou bloqueada na sua rede. O Radar não inventa dados: espere ou use outra fonte. |
| "Fonte não configurada" | Falta a chave daquela fonte no `.env`. Veja `docs/DATA_SOURCES.md`. |
