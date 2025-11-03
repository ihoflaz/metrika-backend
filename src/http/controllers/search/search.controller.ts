import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getSearchService, type SearchResultType } from '../../../modules/search/search.service';
import { logger } from '../../../lib/logger';
import { validationError } from '../../../common/errors';
import type { AuthenticatedRequestUser } from '../../types/auth-context';

const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Search query is required'),
  type: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return Array.isArray(val) ? val : [val];
    }),
  projectId: z.string().uuid().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().min(1).max(100)),
  minSimilarity: z
    .string()
    .optional()
    .transform((val) => (val ? parseFloat(val) : 0.1))
    .pipe(z.number().min(0).max(1)),
});

/**
 * GET /api/v1/search
 * Perform full-text search across tasks, projects, documents, and KPIs
 */
export async function search(req: Request, res: Response, next: NextFunction) {
  try {
    const authUser = res.locals.authUser as AuthenticatedRequestUser;

    // Validate query parameters
    const validation = searchQuerySchema.safeParse(req.query);
    if (!validation.success) {
      throw validationError(validation.error.flatten().fieldErrors);
    }

    const { q: query, type, projectId, limit, minSimilarity } = validation.data;

    logger.info(
      { userId: authUser.id, query, type, projectId, limit },
      '[SearchController] Search request received'
    );

    // Validate types if provided
    const validTypes: SearchResultType[] = ['TASK', 'PROJECT', 'DOCUMENT', 'KPI'];
    let types: SearchResultType[] | undefined;

    if (type) {
      const invalidTypes = type.filter((t) => !validTypes.includes(t as SearchResultType));
      if (invalidTypes.length > 0) {
        throw validationError({
          message: `Invalid search type(s): ${invalidTypes.join(', ')}`,
          path: 'type',
        });
      }
      types = type as SearchResultType[];
    }

    const searchService = getSearchService();
    const results = await searchService.search({
      query,
      types,
      projectId,
      limit,
      minSimilarity,
    });

    logger.info(
      { userId: authUser.id, query, totalResults: results.total },
      '[SearchController] Search completed successfully'
    );

    res.json({
      data: results.results,
      meta: {
        total: results.total,
        query: results.query,
        limit,
        types: types || validTypes,
      },
    });
  } catch (error) {
    next(error);
  }
}
