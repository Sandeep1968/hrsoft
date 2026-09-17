-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('SELF', 'TEAM', 'ALL');

-- AlterTable
ALTER TABLE "RolePermission" ADD COLUMN     "scope" "PermissionScope" NOT NULL DEFAULT 'ALL';
