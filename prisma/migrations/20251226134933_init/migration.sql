-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('REDECANAIS', 'VIZER');

-- CreateEnum
CREATE TYPE "Audio" AS ENUM ('UNKNOWN', 'DUBBED', 'SUBTITLED', 'ORIGINAL');

-- CreateEnum
CREATE TYPE "Quality" AS ENUM ('UNKNOWN', 'SD', 'HD', 'FHD', 'UHD');

-- CreateTable
CREATE TABLE "movies" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "thumbnail" TEXT NOT NULL,
    "poster" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "thumbnail" TEXT NOT NULL,
    "poster" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movie_genres" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movie_genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series_genres" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_genres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movie_streams" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "refreshUrl" TEXT NOT NULL,
    "accessUrl" TEXT,
    "audio" "Audio" NOT NULL,
    "quality" "Quality" NOT NULL,
    "movieId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movie_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series_streams" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "refreshUrl" TEXT NOT NULL,
    "accessUrl" TEXT,
    "season" INTEGER,
    "episode" INTEGER,
    "audio" "Audio" NOT NULL,
    "seriesId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_MovieToMovieGenre" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_MovieToMovieGenre_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_SeriesToSeriesGenre" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_SeriesToSeriesGenre_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "movies_id_key" ON "movies"("id");

-- CreateIndex
CREATE INDEX "movies_title_idx" ON "movies"("title");

-- CreateIndex
CREATE UNIQUE INDEX "series_id_key" ON "series"("id");

-- CreateIndex
CREATE INDEX "series_title_idx" ON "series"("title");

-- CreateIndex
CREATE UNIQUE INDEX "movie_genres_id_key" ON "movie_genres"("id");

-- CreateIndex
CREATE INDEX "movie_genres_name_idx" ON "movie_genres"("name");

-- CreateIndex
CREATE UNIQUE INDEX "series_genres_id_key" ON "series_genres"("id");

-- CreateIndex
CREATE INDEX "series_genres_name_idx" ON "series_genres"("name");

-- CreateIndex
CREATE UNIQUE INDEX "movie_streams_id_key" ON "movie_streams"("id");

-- CreateIndex
CREATE UNIQUE INDEX "series_streams_id_key" ON "series_streams"("id");

-- CreateIndex
CREATE INDEX "series_streams_season_episode_idx" ON "series_streams"("season", "episode");

-- CreateIndex
CREATE INDEX "_MovieToMovieGenre_B_index" ON "_MovieToMovieGenre"("B");

-- CreateIndex
CREATE INDEX "_SeriesToSeriesGenre_B_index" ON "_SeriesToSeriesGenre"("B");

-- AddForeignKey
ALTER TABLE "movie_streams" ADD CONSTRAINT "movie_streams_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series_streams" ADD CONSTRAINT "series_streams_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MovieToMovieGenre" ADD CONSTRAINT "_MovieToMovieGenre_A_fkey" FOREIGN KEY ("A") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MovieToMovieGenre" ADD CONSTRAINT "_MovieToMovieGenre_B_fkey" FOREIGN KEY ("B") REFERENCES "movie_genres"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SeriesToSeriesGenre" ADD CONSTRAINT "_SeriesToSeriesGenre_A_fkey" FOREIGN KEY ("A") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SeriesToSeriesGenre" ADD CONSTRAINT "_SeriesToSeriesGenre_B_fkey" FOREIGN KEY ("B") REFERENCES "series_genres"("id") ON DELETE CASCADE ON UPDATE CASCADE;
