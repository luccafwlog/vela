import fs from 'fs';
import path from 'path';
import https from 'https';
import { URL } from 'url';

const cssUrl = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600&display=swap';
const fontsDir = path.resolve('public', 'fonts');

if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function run() {
  console.log('Fetching CSS...');
  const cssBuffer = await fetchUrl(cssUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    }
  });
  let cssText = cssBuffer.toString('utf-8');

  // Fontes variáveis: o Google devolve a mesma URL para todos os pesos. Um
  // arquivo local por URL faz o navegador baixar cada subset uma vez só, em vez
  // de uma vez por peso (DM Sans latin era baixada 3x).
  const fontUrls = [...new Set([...cssText.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map((match) => match[1]))];

  console.log('Downloading fonts...');
  for (const [index, fontUrl] of fontUrls.entries()) {
    const filename = `font-${index + 1}.woff2`;
    const fontPath = path.join(fontsDir, filename);

    console.log(`Downloading ${fontUrl} to ${filename}`);
    const fontBuffer = await fetchUrl(fontUrl);
    fs.writeFileSync(fontPath, fontBuffer);

    cssText = cssText.replaceAll(fontUrl, `/fonts/${filename}`);
  }

  const cssPath = path.resolve('src', 'fonts.css');
  fs.writeFileSync(cssPath, cssText);
  console.log('Done. CSS saved to src/fonts.css');
}

run().catch(console.error);
