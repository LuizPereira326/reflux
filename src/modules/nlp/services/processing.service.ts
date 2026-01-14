import { Injectable } from '@nestjs/common';
import * as similarity from 'string-similarity';

@Injectable()
export class NlpProcessingService {
  public constructor() {}

  public normalize(text: string): string {
    return String(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  public isPhraseSimilar(
    thisPhrase: string,
    thatPhrase: string,
    minimumSimilarityPercentage: number = 75,
  ): boolean {
    const thisWords = this.normalize(thisPhrase).split(/\s+/);
    const thatWords = this.normalize(thatPhrase).split(/\s+/);

    const exactWords = new Set<string>();

    for (const word1 of thisWords) {
      for (const word2 of thatWords) {
        if (word1 === word2) {
          exactWords.add(word1);
          break;
        }
      }
    }

    const totalWords = Math.min(thisWords.length, thatWords.length);
    const similarWordCount = exactWords.size;

    const similarityPercentage = (similarWordCount / totalWords) * 100;
    return similarityPercentage >= minimumSimilarityPercentage;
  }

  public findBestMatch(
    content: string,
    available: string[],
    limit: number = 50,
  ): {
    result: string;
    equality: number;
    index: number;
  } | null {
    const normalizedContent = this.normalize(content);
    const matches = available.map((availableTitle, i) => {
      const normalizedAvailable = this.normalize(availableTitle);
      const equality = this.isPhraseSimilar(content, availableTitle, 0)
        ? (this.normalize(content)
            .split(/\s+/)
            .filter((word) => normalizedAvailable.includes(word)).length /
            Math.max(
              normalizedContent.split(/\s+/).length,
              normalizedAvailable.split(/\s+/).length,
            )) *
          100
        : 0;

      return { availableTitle, equality, index: i };
    });

    const bestMatch = matches.sort((a, b) => b.equality - a.equality)[0] ?? {
      equality: 0,
      availableTitle: null,
      index: 0,
    };

    return bestMatch.equality > limit
      ? {
          result: bestMatch.availableTitle,
          equality: bestMatch.equality,
          index: bestMatch.index,
        }
      : null;
  }

  public compareBestMatch(
    content: string,
    available: string[],
    limit: number = 50,
  ): {
    result: string;
    equality: number;
    index: number;
  } | null {
    const normalizeForComparison = (text: string) => {
      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const normalizedContent = normalizeForComparison(content);
    const matches = available.map((availableTitle, i) => {
      const normalizedAvailable = normalizeForComparison(availableTitle);
      const equality =
        similarity.compareTwoStrings(normalizedContent, normalizedAvailable) *
        100;

      return { availableTitle, equality, index: i };
    });

    const bestMatch = matches.sort((a, b) => {
      return (
        b.equality - a.equality ||
        a.availableTitle.length - b.availableTitle.length
      );
    })[0] ?? {
      equality: 0,
      availableTitle: null,
      index: 0,
    };

    const adjustedLimit =
      normalizedContent.split(/\s+/).length > 3 ? 70 : limit;

    return bestMatch.equality >= adjustedLimit
      ? {
          result: bestMatch.availableTitle,
          equality: bestMatch.equality,
          index: bestMatch.index,
        }
      : null;
  }
}
