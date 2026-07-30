/*
  Warnings:

  - Changed the type of `notification_payload` on the `notifications` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "notification_payload",
ADD COLUMN     "notification_payload" JSONB NOT NULL;
