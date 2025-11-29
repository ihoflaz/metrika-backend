import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../../lib/logger';

export type SearchResultType = 'TASK' | 'PROJECT' | 'DOCUMENT' | 'KPI';

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  description?: string;
  relevanceScore: number;
  projectId?: string;
  projectName?: string;
  metadata?: {
    status?: string;
    code?: string;
    docType?: string;
    ownerName?: string;
    createdAt?: Date;
    updatedAt?: Date;
  };
}

export interface SearchOptions {
  query: string;
  types?: SearchResultType[];
  projectId?: string;
  limit?: number;
  minSimilarity?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
}

/**
 * Full-text search service using PostgreSQL pg_trgm extension
 * Provides fuzzy matching with relevance ranking across multiple entity types
 */
export class SearchService {
  private prisma: PrismaClient;
  private logger = logger.child({ service: 'SearchService' });
  private readonly extensionReady: Promise<void>;

  constructor() {
    this.prisma = new PrismaClient();
    this.extensionReady = this.ensureExtensions();
  }

  /**
   * Perform full-text search across multiple entity types
   * Uses pg_trgm similarity() function for fuzzy matching
   */
  async search(options: SearchOptions): Promise<SearchResponse> {
    await this.extensionReady;
    const {
      query,
      types = ['TASK', 'PROJECT', 'DOCUMENT', 'KPI'],
      projectId,
      limit = 20,
      minSimilarity = 0.1, // 10% similarity threshold (lower = more results)
    } = options;

    this.logger.info(
      { query, types, projectId, limit },
      '[SearchService] Performing full-text search'
    );

    const results: SearchResult[] = [];

    // Search in parallel across all entity types
    const searchPromises: Promise<SearchResult[]>[] = [];

    if (types.includes('TASK')) {
      searchPromises.push(this.searchTasks(query, projectId, limit, minSimilarity));
    }

    if (types.includes('PROJECT')) {
      searchPromises.push(this.searchProjects(query, projectId, limit, minSimilarity));
    }

    if (types.includes('DOCUMENT')) {
      searchPromises.push(this.searchDocuments(query, projectId, limit, minSimilarity));
    }

    if (types.includes('KPI')) {
      searchPromises.push(this.searchKPIs(query, projectId, limit, minSimilarity));
    }

    const searchResults = await Promise.all(searchPromises);

    // Flatten and combine all results
    for (const entityResults of searchResults) {
      results.push(...entityResults);
    }

    // Sort by relevance score (descending)
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Limit total results
    const limitedResults = results.slice(0, limit);

    this.logger.info(
      { query, totalResults: limitedResults.length },
      '[SearchService] Search completed'
    );

    return {
      results: limitedResults,
      total: limitedResults.length,
      query,
    };
  }

  private async ensureExtensions() {
    try {
      await this.prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to ensure pg_trgm extension');
    }
  }

  /**
   * Search tasks using fuzzy text matching on title and description
   */
  private async searchTasks(
    query: string,
    projectId: string | undefined,
    limit: number,
    minSimilarity: number
  ): Promise<SearchResult[]> {
    // Use raw SQL for pg_trgm similarity search
    const sql = Prisma.sql`
      SELECT 
        t.id,
        t.title,
        t.description,
        t.status,
        t."projectId",
        p.name as "projectName",
        u."fullName" as "ownerName",
        t."createdAt",
        t."updatedAt",
        GREATEST(
        public.similarity(t.title, ${query}::text),
        COALESCE(public.similarity(t.description, ${query}::text), 0)
        ) as relevance
      FROM "Task" t
      LEFT JOIN "Project" p ON t."projectId" = p.id
      LEFT JOIN "User" u ON t."ownerId" = u.id
      WHERE 
        (
          public.similarity(t.title, ${query}::text) > ${minSimilarity}
          OR public.similarity(t.description, ${query}::text) > ${minSimilarity}
        )
        ${projectId ? Prisma.sql`AND t."projectId" = ${projectId}::uuid` : Prisma.empty}
      ORDER BY relevance DESC
      LIMIT ${limit}
    `;

    const tasks = await this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        description: string | null;
        status: string;
        projectId: string;
        projectName: string;
        ownerName: string;
        createdAt: Date;
        updatedAt: Date;
        relevance: number;
      }>
    >(sql);

    return tasks.map((task) => ({
      id: task.id,
      type: 'TASK' as SearchResultType,
      title: task.title,
      description: task.description || undefined,
      relevanceScore: task.relevance,
      projectId: task.projectId,
      projectName: task.projectName,
      metadata: {
        status: task.status,
        ownerName: task.ownerName,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    }));
  }

  /**
   * Search projects using fuzzy text matching on name and description
   */
  private async searchProjects(
    query: string,
    projectId: string | undefined,
    limit: number,
    minSimilarity: number
  ): Promise<SearchResult[]> {
    const sql = Prisma.sql`
      SELECT 
        p.id,
        p.name,
        p.description,
        p.status,
        p.code,
        p."createdAt",
        p."updatedAt",
        GREATEST(
        public.similarity(p.name, ${query}::text),
        COALESCE(public.similarity(p.description, ${query}::text), 0)
        ) as relevance
      FROM "Project" p
      WHERE 
        (
          public.similarity(p.name, ${query}::text) > ${minSimilarity}
          OR public.similarity(p.description, ${query}::text) > ${minSimilarity}
        )
        ${projectId ? Prisma.sql`AND p.id = ${projectId}::uuid` : Prisma.empty}
      ORDER BY relevance DESC
      LIMIT ${limit}
    `;

    const projects = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        description: string | null;
        status: string;
        code: string;
        createdAt: Date;
        updatedAt: Date;
        relevance: number;
      }>
    >(sql);

    return projects.map((project) => ({
      id: project.id,
      type: 'PROJECT' as SearchResultType,
      title: project.name,
      description: project.description || undefined,
      relevanceScore: project.relevance,
      projectId: project.id,
      projectName: project.name,
      metadata: {
        status: project.status,
        code: project.code,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    }));
  }

  /**
   * Search documents using fuzzy text matching on title
   */
  private async searchDocuments(
    query: string,
    projectId: string | undefined,
    limit: number,
    minSimilarity: number
  ): Promise<SearchResult[]> {
    const sql = Prisma.sql`
      SELECT 
        d.id,
        d.title,
        d."docType",
        d."projectId",
        p.name as "projectName",
        u."fullName" as "ownerName",
        d."createdAt",
        d."updatedAt",
        public.similarity(d.title, ${query}::text) as relevance
      FROM "Document" d
      LEFT JOIN "Project" p ON d."projectId" = p.id
      LEFT JOIN "User" u ON d."ownerId" = u.id
      WHERE public.similarity(d.title, ${query}::text) > ${minSimilarity}
        ${projectId ? Prisma.sql`AND d."projectId" = ${projectId}::uuid` : Prisma.empty}
      ORDER BY relevance DESC
      LIMIT ${limit}
    `;

    const documents = await this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        docType: string;
        projectId: string;
        projectName: string;
        ownerName: string;
        createdAt: Date;
        updatedAt: Date;
        relevance: number;
      }>
    >(sql);

    return documents.map((doc) => ({
      id: doc.id,
      type: 'DOCUMENT' as SearchResultType,
      title: doc.title,
      relevanceScore: doc.relevance,
      projectId: doc.projectId,
      projectName: doc.projectName,
      metadata: {
        docType: doc.docType,
        ownerName: doc.ownerName,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    }));
  }

  /**
   * Search KPIs using fuzzy text matching on name and code
   */
  private async searchKPIs(
    query: string,
    projectId: string | undefined,
    limit: number,
    minSimilarity: number
  ): Promise<SearchResult[]> {
    const sql = Prisma.sql`
      SELECT 
        k.id,
        k.name,
        k.code,
        k.status,
        k."createdAt",
        k."updatedAt",
        GREATEST(
          public.similarity(k.name, ${query}::text),
          public.similarity(k.code, ${query}::text)
        ) as relevance
      FROM "KPIDefinition" k
      WHERE 
        (
          public.similarity(k.name, ${query}::text) > ${minSimilarity}
          OR public.similarity(k.code, ${query}::text) > ${minSimilarity}
        )
        ${
          projectId
            ? Prisma.sql`AND k."linkedProjectIds" @> ARRAY[${projectId}]::text[]`
            : Prisma.empty
        }
      ORDER BY relevance DESC
      LIMIT ${limit}
    `;

    const kpis = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        code: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        relevance: number;
      }>
    >(sql);

    return kpis.map((kpi) => ({
      id: kpi.id,
      type: 'KPI' as SearchResultType,
      title: kpi.name,
      relevanceScore: kpi.relevance,
      metadata: {
        code: kpi.code,
        status: kpi.status,
        createdAt: kpi.createdAt,
        updatedAt: kpi.updatedAt,
      },
    }));
  }
}

// Singleton instance
let searchServiceInstance: SearchService | null = null;

export function getSearchService(): SearchService {
  if (!searchServiceInstance) {
    searchServiceInstance = new SearchService();
  }
  return searchServiceInstance;
}
