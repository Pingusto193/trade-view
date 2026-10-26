import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MacroService } from '../macro/service';

/** Contexto Brasil (SPEC §15): Selic e CDI do Banco Central. */
export function macroRoutes(app: FastifyInstance, macro: MacroService) {
  app.get('/api/macro/brasil', async () => macro.brasil());

  /** CDI acumulado num período (para comparar o treino ou um backtest com a renda fixa). */
  app.get('/api/macro/cdi', async (req) => {
    const q = z
      .object({ from: z.coerce.number().int().positive(), to: z.coerce.number().int().positive() })
      .parse(req.query);
    await macro.refresh();
    // períodos longos (backtest da previsão): busca o histórico que faltar, sem esperar demais
    await Promise.race([
      macro.ensureCdiFrom(q.from),
      new Promise((ok) => setTimeout(ok, 8000).unref?.()),
    ]);
    return { cdi: macro.cdiBetween(q.from, q.to) };
  });
}
