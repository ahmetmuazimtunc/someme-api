-- AlterTable
ALTER TABLE "captions" ADD COLUMN     "report_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caption_tags" (
    "caption_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "caption_tags_pkey" PRIMARY KEY ("caption_id","tag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "tags_name_idx" ON "tags"("name");

-- CreateIndex
CREATE INDEX "tags_count_idx" ON "tags"("count");

-- CreateIndex
CREATE INDEX "caption_tags_tag_id_idx" ON "caption_tags"("tag_id");

-- CreateIndex
CREATE INDEX "caption_tags_caption_id_idx" ON "caption_tags"("caption_id");

-- CreateIndex
CREATE INDEX "captions_language_idx" ON "captions"("language");

-- CreateIndex
CREATE INDEX "captions_rank_idx" ON "captions"("rank");

-- AddForeignKey
ALTER TABLE "caption_tags" ADD CONSTRAINT "caption_tags_caption_id_fkey" FOREIGN KEY ("caption_id") REFERENCES "captions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caption_tags" ADD CONSTRAINT "caption_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
