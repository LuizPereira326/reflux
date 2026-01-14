import { Page } from 'playwright';

export interface TopFlixItem {
  title: string;
  year: string;
  rating: string;
  genres: string[];
  link: string;
  image: string;
}

export class CatalogScraper {
  static async parse(page: Page): Promise<TopFlixItem[]> {
    const results: TopFlixItem[] = [];
    const items = await page.locator('#dle-content .default.poster').all();

    for (const item of items) {
      try {
        const title = (await item.locator('.poster__title span').textContent())?.trim() || '';
        const link = (await item.locator('.poster__title a').getAttribute('href')) || '';
        const image = (await item.locator('.poster__img img').getAttribute('src')) || '';
        const year = (await item.locator('.bslide__meta span').first().textContent())?.trim() || '';
        const rating = (await item.locator('.rating').textContent())?.trim() || '';

        const genres: string[] = [];
        const genreLinks = await item.locator('.onslide-cats a').all();
        for (const g of genreLinks) {
          const text = await g.textContent();
          if (text) genres.push(text.trim());
        }

        results.push({ title, year, rating, genres, link, image });
      } catch (err) {
        // não quebra o loop
      }
    }
    return results;
  }
}
