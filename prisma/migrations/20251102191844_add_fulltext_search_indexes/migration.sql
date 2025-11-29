-- Enable trigram search capabilities for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Ensure search_vector columns exist
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;

-- Document search vector trigger
CREATE OR REPLACE FUNCTION document_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."search_vector" :=
    to_tsvector(
      'english',
      COALESCE(NEW."title", '') || ' ' ||
      COALESCE(NEW."docType"::text, '') || ' ' ||
      COALESCE(NEW."classification"::text, '') || ' ' ||
      COALESCE(array_to_string(NEW."tags", ' '), '')
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_search_vector_trigger ON "Document";
CREATE TRIGGER document_search_vector_trigger
BEFORE INSERT OR UPDATE ON "Document"
FOR EACH ROW EXECUTE FUNCTION document_search_vector_update();

UPDATE "Document"
SET "search_vector" =
  to_tsvector(
    'english',
    COALESCE("title", '') || ' ' ||
    COALESCE("docType"::text, '') || ' ' ||
    COALESCE("classification"::text, '') || ' ' ||
    COALESCE(array_to_string("tags", ' '), '')
  );

-- Task search vector trigger
CREATE OR REPLACE FUNCTION task_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."search_vector" :=
    to_tsvector(
      'english',
      COALESCE(NEW."title", '') || ' ' ||
      COALESCE(NEW."description", '') || ' ' ||
      COALESCE(NEW."code", '')
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_search_vector_trigger ON "Task";
CREATE TRIGGER task_search_vector_trigger
BEFORE INSERT OR UPDATE ON "Task"
FOR EACH ROW EXECUTE FUNCTION task_search_vector_update();

UPDATE "Task"
SET "search_vector" =
  to_tsvector(
    'english',
    COALESCE("title", '') || ' ' ||
    COALESCE("description", '') || ' ' ||
    COALESCE("code", '')
  );

-- Project search vector trigger
CREATE OR REPLACE FUNCTION project_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."search_vector" :=
    to_tsvector(
      'english',
      COALESCE(NEW."name", '') || ' ' ||
      COALESCE(NEW."description", '') || ' ' ||
      COALESCE(NEW."code", '')
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_search_vector_trigger ON "Project";
CREATE TRIGGER project_search_vector_trigger
BEFORE INSERT OR UPDATE ON "Project"
FOR EACH ROW EXECUTE FUNCTION project_search_vector_update();

UPDATE "Project"
SET "search_vector" =
  to_tsvector(
    'english',
    COALESCE("name", '') || ' ' ||
    COALESCE("description", '') || ' ' ||
    COALESCE("code", '')
  );

-- Document search vector index
CREATE INDEX IF NOT EXISTS "Document_search_vector_idx"
  ON "Document"
  USING GIN ("search_vector");

-- Task search vector index
CREATE INDEX IF NOT EXISTS "Task_search_vector_idx"
  ON "Task"
  USING GIN ("search_vector");

-- Project search vector index
CREATE INDEX IF NOT EXISTS "Project_search_vector_idx"
  ON "Project"
  USING GIN ("search_vector");
