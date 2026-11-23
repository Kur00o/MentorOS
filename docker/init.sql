-- docker/init.sql
-- Runs automatically when the container first boots.
-- Enables the pgvector extension in the mentoros database.
CREATE EXTENSION IF NOT EXISTS vector;