-- Add new role for scoped financial access
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUBSECTION';

-- Module access controls + optional subsection scope
ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "can_access_dashboard" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "can_access_services" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "can_access_financial" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "subsecao_scope" TEXT;
