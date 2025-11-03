import { Router } from 'express';
import { requirePermissions } from '../../middleware/auth/authentication';
import { PERMISSIONS } from '../../../modules/rbac/permissions';
import { search } from '../../controllers/search/search.controller';

export function createSearchRouter(): Router {
  const router = Router();

  /**
   * GET /api/v1/search
   * Full-text search across tasks, projects, documents, and KPIs
   * Supports fuzzy matching with relevance ranking
   * 
   * Query params:
   * - q: Search query (required)
   * - type: Filter by entity type (TASK, PROJECT, DOCUMENT, KPI) - can be array
   * - projectId: Filter by project ID (optional)
   * - limit: Max results (default: 20, max: 100)
   * - minSimilarity: Minimum similarity threshold (default: 0.1, range: 0-1)
   * 
   * Permission: DOCUMENT_READ (read access)
   */
  router.get('/', requirePermissions(PERMISSIONS.DOCUMENT_READ), search);

  return router;
}
