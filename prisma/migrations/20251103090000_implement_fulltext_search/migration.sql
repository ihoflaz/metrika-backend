-- Full-Text Search Implementation for Week 3 (Day 15)
-- Add ts_vector columns and GIN indexes to documents, tasks, and projects tables

-- Enable PostgreSQL pg_trgm extension for trigram similarity matching
DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'pg_trgm extension could not be created due to insufficient privileges.';
  END;
END$$;


-- Enable PostgreSQL full-text search extension (if not already enabled)
-- This is usually enabled by default in PostgreSQL

-- =============================================
-- DOCUMENT TABLE: Add full-text search
-- =============================================

-- Add tsvector column for document search
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;

-- Create function to update search vector
CREATE OR REPLACE FUNCTION document_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(NEW.tags, ' ')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update search vector
DROP TRIGGER IF EXISTS document_search_vector_trigger ON "Document";
CREATE TRIGGER document_search_vector_trigger
  BEFORE INSERT OR UPDATE ON "Document"
  FOR EACH ROW
  EXECUTE FUNCTION document_search_vector_update();

-- Update existing documents with search vectors
UPDATE "Document" SET search_vector =
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', array_to_string(tags, ' ')), 'B');

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS "Document_search_vector_idx" ON "Document" USING GIN (search_vector);

-- =============================================
-- TASK TABLE: Add full-text search
-- =============================================

-- Add tsvector column for task search
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;

-- Create function to update task search vector
CREATE OR REPLACE FUNCTION task_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.code, '')), 'A');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update task search vector
DROP TRIGGER IF EXISTS task_search_vector_trigger ON "Task";
CREATE TRIGGER task_search_vector_trigger
  BEFORE INSERT OR UPDATE ON "Task"
  FOR EACH ROW
  EXECUTE FUNCTION task_search_vector_update();

-- Update existing tasks with search vectors
UPDATE "Task" SET search_vector =
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(description, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(code, '')), 'A');

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS "Task_search_vector_idx" ON "Task" USING GIN (search_vector);

-- =============================================
-- PROJECT TABLE: Add full-text search
-- =============================================

-- Add tsvector column for project search
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;

-- Create function to update project search vector
CREATE OR REPLACE FUNCTION project_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.code, '')), 'A');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update project search vector
DROP TRIGGER IF EXISTS project_search_vector_trigger ON "Project";
CREATE TRIGGER project_search_vector_trigger
  BEFORE INSERT OR UPDATE ON "Project"
  FOR EACH ROW
  EXECUTE FUNCTION project_search_vector_update();

-- Update existing projects with search vectors
UPDATE "Project" SET search_vector =
  setweight(to_tsvector('english', COALESCE(name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(description, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(code, '')), 'A');

-- Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS "Project_search_vector_idx" ON "Project" USING GIN (search_vector);

-- =============================================
-- PERFORMANCE: Add additional indexes
-- =============================================

-- Document search performance indexes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS "Document_title_trgm_idx" ON "Document" USING GIN (title gin_trgm_ops)';
    EXCEPTION
      WHEN undefined_object THEN
        RAISE NOTICE 'Skipping Document_title_trgm_idx because gin_trgm_ops is not available.';
    END;
  ELSE
    RAISE NOTICE 'Skipping Document_title_trgm_idx because pg_trgm is not available.';
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS "Document_tags_idx" ON "Document" USING GIN (tags);

-- Task search performance indexes  
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS "Task_title_trgm_idx" ON "Task" USING GIN (title gin_trgm_ops)';
    EXCEPTION
      WHEN undefined_object THEN
        RAISE NOTICE 'Skipping Task_title_trgm_idx because gin_trgm_ops is not available.';
    END;
  ELSE
    RAISE NOTICE 'Skipping Task_title_trgm_idx because pg_trgm is not available.';
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS "Task_code_idx" ON "Task" (code) WHERE code IS NOT NULL;

-- Project search performance indexes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS "Project_name_trgm_idx" ON "Project" USING GIN (name gin_trgm_ops)';
    EXCEPTION
      WHEN undefined_object THEN
        RAISE NOTICE 'Skipping Project_name_trgm_idx because gin_trgm_ops is not available.';
    END;
  ELSE
    RAISE NOTICE 'Skipping Project_name_trgm_idx because pg_trgm is not available.';
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS "Project_code_idx" ON "Project" (code);

-- Note: pg_trgm extension is required for trigram indexes
-- If it is not available, the trigram-based indexes above will be skipped.
