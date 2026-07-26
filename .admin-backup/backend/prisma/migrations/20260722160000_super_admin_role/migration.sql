-- SUPER_ADMIN role — all-access administrator.
-- Isolated in its own migration: a new enum value cannot be added and used in
-- the same transaction on PostgreSQL.
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
