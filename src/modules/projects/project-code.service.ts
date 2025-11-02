import type { PrismaClient } from '@prisma/client';

/**
 * ProjectCodeService
 * 
 * Generates unique project codes in PRJ-YYYY-NNNN format.
 * Uses a database sequence table to ensure uniqueness across concurrent requests.
 * 
 * Format: PRJ-2025-0001, PRJ-2025-0002, etc.
 * - Each year has its own sequence starting from 1
 * - Sequence is zero-padded to 4 digits
 * - Thread-safe using database transactions
 */
export class ProjectCodeService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Generate next project code for current year
   * @returns Project code in format PRJ-YYYY-NNNN
   * 
   * @example
   * const code = await projectCodeService.generateCode();
   * // Returns: "PRJ-2025-0001"
   */
  async generateCode(): Promise<string> {
    const year = new Date().getFullYear();
    return this.generateCodeForYear(year);
  }

  /**
   * Generate project code for specific year
   * @param year - Year for the project code
   * @returns Project code in format PRJ-YYYY-NNNN
   * 
   * @example
   * const code = await projectCodeService.generateCodeForYear(2025);
   * // Returns: "PRJ-2025-0042"
   */
  async generateCodeForYear(year: number): Promise<string> {
    // Use transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // Get or create sequence record for the year
      let sequence = await tx.projectCode.findUnique({
        where: { year },
      });

      if (!sequence) {
        // Create new sequence for the year
        sequence = await tx.projectCode.create({
          data: {
            year,
            nextSequence: 2, // Start at 2, since we're returning 1
          },
        });
        return { year, sequence: 1 };
      }

      // Increment sequence and return current value
      const currentSequence = sequence.nextSequence;
      await tx.projectCode.update({
        where: { year },
        data: {
          nextSequence: currentSequence + 1,
        },
      });

      return { year, sequence: currentSequence };
    });

    // Format: PRJ-YYYY-NNNN
    const paddedSequence = result.sequence.toString().padStart(4, '0');
    return `PRJ-${result.year}-${paddedSequence}`;
  }

  /**
   * Reserve a specific project code (if available)
   * Used when migrating existing projects or restoring from backup
   * 
   * @param code - Project code to reserve (e.g., "PRJ-2025-0100")
   * @returns true if reserved successfully, false if already exists
   * 
   * @example
   * const reserved = await projectCodeService.reserveCode("PRJ-2025-0100");
   * if (reserved) {
   *   // Code is now reserved, create project with this code
   * }
   */
  async reserveCode(code: string): Promise<boolean> {
    // Parse code format: PRJ-YYYY-NNNN
    const match = code.match(/^PRJ-(\d{4})-(\d{4})$/);
    if (!match) {
      throw new Error(`Invalid project code format: ${code}. Expected: PRJ-YYYY-NNNN`);
    }

    const year = parseInt(match[1], 10);
    const sequence = parseInt(match[2], 10);

    // Check if project with this code already exists
    const existingProject = await this.prisma.project.findUnique({
      where: { code },
    });

    if (existingProject) {
      return false; // Code already in use
    }

    // Update sequence if this code is higher than current
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.projectCode.findUnique({
        where: { year },
      });

      if (!current) {
        // Create new sequence starting after this code
        await tx.projectCode.create({
          data: {
            year,
            nextSequence: sequence + 1,
          },
        });
      } else if (current.nextSequence <= sequence) {
        // Update sequence to ensure we don't reuse this code
        await tx.projectCode.update({
          where: { year },
          data: {
            nextSequence: sequence + 1,
          },
        });
      }
    });

    return true;
  }

  /**
   * Release a project code (when project is deleted before creation completes)
   * Note: This does NOT decrement the sequence. Once a code is issued,
   * it's marked as "used" to maintain auditability.
   * 
   * @param code - Project code to release
   * 
   * @example
   * await projectCodeService.releaseCode("PRJ-2025-0123");
   */
  async releaseCode(code: string): Promise<void> {
    // Validate format
    const match = code.match(/^PRJ-(\d{4})-(\d{4})$/);
    if (!match) {
      throw new Error(`Invalid project code format: ${code}. Expected: PRJ-YYYY-NNNN`);
    }

    // Note: We don't decrement the sequence because:
    // 1. It maintains audit trail (code was issued)
    // 2. Prevents race conditions
    // 3. Keeps codes monotonically increasing
    
    // In the future, we could add a "ReleasedProjectCode" table
    // to track codes that were issued but never used
  }

  /**
   * Get current sequence number for a year
   * Useful for monitoring and debugging
   * 
   * @param year - Year to check (defaults to current year)
   * @returns Current sequence number, or 0 if year not yet initialized
   * 
   * @example
   * const nextSeq = await projectCodeService.getCurrentSequence(2025);
   * console.log(`Next project will be PRJ-2025-${nextSeq.toString().padStart(4, '0')}`);
   */
  async getCurrentSequence(year?: number): Promise<number> {
    const targetYear = year ?? new Date().getFullYear();
    
    const sequence = await this.prisma.projectCode.findUnique({
      where: { year: targetYear },
    });

    return sequence?.nextSequence ?? 1;
  }

  /**
   * Reset sequence for a year (use with caution!)
   * Only use in development or when migrating/resetting data
   * 
   * @param year - Year to reset
   * @param startFrom - Sequence number to start from (default: 1)
   * 
   * @example
   * await projectCodeService.resetSequence(2025, 1);
   */
  async resetSequence(year: number, startFrom: number = 1): Promise<void> {
    await this.prisma.projectCode.upsert({
      where: { year },
      create: {
        year,
        nextSequence: startFrom,
      },
      update: {
        nextSequence: startFrom,
      },
    });
  }
}
