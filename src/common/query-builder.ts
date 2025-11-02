/**
 * Advanced Query Builder Utility
 * Supports filtering, sorting, pagination, and field selection
 */

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface SortingParams {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface FilterParams {
  [key: string]: string | string[] | undefined;
}

export interface QueryOptions extends PaginationParams, SortingParams {
  filters?: FilterParams;
  select?: string[];
}

export interface PaginationResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * Parse pagination parameters with defaults
 */
export const parsePagination = (params: PaginationParams): Required<PaginationParams> => {
  const page = Math.max(1, parseInt(String(params.page || 1), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(params.limit || 20), 10)));
  
  return { page, limit };
};

/**
 * Calculate skip value for Prisma queries
 */
export const calculateSkip = (page: number, limit: number): number => {
  return (page - 1) * limit;
};

/**
 * Build pagination metadata
 */
export const buildPaginationMeta = (
  total: number,
  page: number,
  limit: number,
) => {
  const totalPages = Math.ceil(total / limit);
  
  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

/**
 * Parse date range filter (ISO string or YYYY-MM-DD)
 */
export const parseDateRange = (
  startDate?: string,
  endDate?: string,
): { gte?: Date; lte?: Date } | undefined => {
  if (!startDate && !endDate) {
    return undefined;
  }

  const range: { gte?: Date; lte?: Date } = {};

  if (startDate) {
    const parsed = new Date(startDate);
    if (!isNaN(parsed.getTime())) {
      range.gte = parsed;
    }
  }

  if (endDate) {
    const parsed = new Date(endDate);
    if (!isNaN(parsed.getTime())) {
      // Set to end of day
      parsed.setHours(23, 59, 59, 999);
      range.lte = parsed;
    }
  }

  return Object.keys(range).length > 0 ? range : undefined;
};

/**
 * Parse multiple values filter (comma-separated or array)
 */
export const parseMultipleValues = (value: string | string[] | undefined): string[] | undefined => {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return value.split(',').map(v => v.trim()).filter(Boolean);
};

/**
 * Parse search query for text fields (supports partial match)
 */
export const parseSearchQuery = (query?: string): { contains: string; mode: 'insensitive' } | undefined => {
  if (!query || query.trim() === '') {
    return undefined;
  }

  return {
    contains: query.trim(),
    mode: 'insensitive',
  };
};

/**
 * Validate and sanitize sort field
 */
export const validateSortField = (
  sortBy: string | undefined,
  allowedFields: string[],
  defaultField: string = 'createdAt',
): string => {
  if (!sortBy) {
    return defaultField;
  }

  return allowedFields.includes(sortBy) ? sortBy : defaultField;
};

/**
 * Parse sort order
 */
export const parseSortOrder = (
  sortOrder: string | undefined,
): 'asc' | 'desc' => {
  if (sortOrder?.toLowerCase() === 'asc') {
    return 'asc';
  }
  return 'desc';
};

/**
 * Build Prisma orderBy object
 */
export const buildOrderBy = (
  sortBy: string,
  sortOrder: 'asc' | 'desc',
): Record<string, 'asc' | 'desc'> => {
  return { [sortBy]: sortOrder };
};

/**
 * Create paginated response wrapper
 */
export const createPaginatedResponse = <T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginationResult<T> => {
  return {
    data,
    meta: buildPaginationMeta(total, page, limit),
  };
};
