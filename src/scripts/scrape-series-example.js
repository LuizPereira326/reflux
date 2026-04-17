const axios = require('axios');
const cheerio = require('cheerio');

const URL = 'https://topflix.digital/series/';

async function run() {
  console.log('🚀 Iniciando scraper de TopFlix (Séries)...');
  
  try {
    const { data } = await axios.get(URL);
    const $ = cheerio.load(data);
    
    // Seleciona os cards de séries
    // Vamos pegar os 10 primeiros para teste
    const cards = $('.default.poster.grid-item').slice(0, 10);
    console.log(`📥 Encontrados ${cards.length} cards de séries.`);

    cards.each((index, element) => {
      const $el = $(element);
      
      // 1. Link da Série (O slug é a parte depois de /series/assistir-online-)
      const anchor = $el.find('a').first();
      const href = anchor.attr('href');
      const slugMatch = href.match(/assistir-online-([^/]+)/);
      const slug = slugMatch ? slugMatch[1] : 'desconhecido';

      // 2. Capa (Poster)
      const poster = $el.find('img').attr('src');

      // 3. Título
      const title = $el.find('.poster__title').find('a').text().trim();

      // 4. Ano e Nota (dentro de .bslide__meta)
      // Ex: <span>2025</span> ou <span>8.5</span>
      const yearSpan = $el.find('.poster__title span').first().text();
      const ratingSpan = $el.find('.poster__title span:last-child').first().text();
      
      // 5. Gêneros (Vários links dentro de .onslide-cats)
      const genres = [];
      $el.find('.onslide-cats a').each((i, el) => {
        genres.push($(el).text().trim());
      });

      console.log(`[${index + 1}] ${title}`);
      console.log(`       Slug: ${slug}`);
      console.log(`       Capa: ${poster}`);
      console.log(`       Ano: ${yearSpan} | Nota: ${ratingSpan}`);
      console.log(`       Gêneros: ${genres.join(', ')}`);
    });

  } catch (error) {
    console.error('❌ Erro ao fazer scraping:', error.message);
  }
}

run();
