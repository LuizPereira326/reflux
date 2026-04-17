cat << 'EOF' > scraper-test.js
const { chromium } = require('playwright');
const fs = require('fs');

const urls = [
  'https://redecanais.bh/mapafilmes.html',
  'https://redecanais.bh/mapa.html'
];

(async () => {
  console.log('Iniciando navegador...');
  const browser = await chromium.launch({ 
      headless: true, 
      channel: 'chrome' 
  });
  
  const page = await browser.newPage();

  for (const url of urls) {
    console.log(`\n>>> Tentando acessar: ${url}`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000); 
      const html = await page.content();
      
      if (html.includes('Access denied')) {
        console.log('❌ FALHA: Cloudflare Bloqueou.');
      } else if (html.includes('redecanais.bh/player/')) {
         const regex = /https:\/\/redecanais\.bh\/player\/[^"]+/g;
         const matches = html.match(regex);
         console.log(`✅ SUCESSO: Encontrados ${matches ? matches.length : 0} links.`);
         
         const filename = url.split('/').pop();
         fs.writeFileSync(filename, html);
         console.log(`💾 Salvo em: ${filename}`);
      } else {
        console.log('⚠️ HTML baixado mas formato desconhecido.');
      }
    } catch (error) {
      console.log(`❌ ERRO: ${error.message}`);
    }
  }
  await browser.close();
})();
EOF
