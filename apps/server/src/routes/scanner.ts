import { savedScanInputSchema, scanRunInputSchema } from '@radar/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type PublicUser } from '../auth/service';
import type { ScannerService } from '../scanner/service';

function userOf(req: FastifyRequest): PublicUser {
  if (!req.user) throw new AuthError('Faça login.', 401);
  return req.user;
}

const idParam = z.object({ id: z.string().uuid() });
/** Varrer é pesado para as cotas das fontes: limite próprio, mais baixo que o geral. */
const runLimit = () => ({ config: { rateLimit: { max: 12, timeWindow: '1 minute' } } });

/** Scanner multi-mercado (SPEC §14). Tudo atrás de login. */
export function scannerRoutes(app: FastifyInstance, scanner: ScannerService) {
  app.get('/api/scanner/universes', async (req) => scanner.universes(userOf(req).id));

  app.post('/api/scanner/run', runLimit(), async (req) =>
    scanner.runAdhoc(userOf(req).id, scanRunInputSchema.parse(req.body)),
  );

  app.get('/api/scanner/adhoc', async (req) => ({ snapshot: scanner.adhoc(userOf(req).id) }));

  app.get('/api/scanner/saved', async (req) => ({ scans: scanner.listSaved(userOf(req).id) }));

  app.post('/api/scanner/saved', async (req) =>
    scanner.createSaved(userOf(req).id, savedScanInputSchema.parse(req.body)),
  );

  app.put('/api/scanner/saved/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return scanner.updateSaved(userOf(req).id, id, savedScanInputSchema.parse(req.body));
  });

  app.delete('/api/scanner/saved/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    scanner.removeSaved(userOf(req).id, id);
    return { ok: true };
  });

  app.post('/api/scanner/saved/:id/run', runLimit(), async (req) => {
    const { id } = idParam.parse(req.params);
    return scanner.runSaved(userOf(req).id, id);
  });

  app.get('/api/scanner/saved/:id/result', async (req) => {
    const { id } = idParam.parse(req.params);
    return { snapshot: scanner.savedResult(userOf(req).id, id) };
  });
}
