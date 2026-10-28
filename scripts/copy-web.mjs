// Copies the web app (index.html + icons) into www/ for the Capacitor app,
// and adds the Capacitor runtime so the page can reach native plugins.
// Firebase and the Archivo font are packed into the app too, so it starts without
// waiting on the internet. The root index.html stays a plain web page that also works in a browser.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const OUT = 'www';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const f of ['icon2.png', 'icon-512.png']) {
  if (existsSync(f)) cpSync(f, `${OUT}/${f}`);
}
cpSync('node_modules/@capacitor/core/dist/capacitor.js', `${OUT}/capacitor.js`);

mkdirSync(`${OUT}/vendor`, { recursive: true });
for (const f of ['app', 'auth', 'database']) {
  cpSync(`node_modules/firebase/firebase-${f}-compat.js`, `${OUT}/vendor/firebase-${f}-compat.js`);
}
mkdirSync(`${OUT}/fonts`, { recursive: true });
const FONT = 'archivo-latin-wdth-normal.woff2';
cpSync(`node_modules/@fontsource-variable/archivo/files/${FONT}`, `${OUT}/fonts/${FONT}`);

// Each swap must find its text, so a change to index.html can't quietly bring the downloads back
const swap = (html, from, to) => {
  if (!html.includes(from)) throw new Error(`index.html is missing: ${from}`);
  return html.split(from).join(to);
};
let html = readFileSync('index.html', 'utf8');
html = swap(html, '<!-- capacitor runtime -->', '<script src="capacitor.js"></script>');
html = swap(html, 'https://www.gstatic.com/firebasejs/9.23.0/', 'vendor/');
html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>\n?/g, '');
html = swap(html, '<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap" rel="stylesheet" media="print" onload="this.media=\'all\'">',
  `<link rel="preload" href="fonts/${FONT}" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'Archivo';font-style:normal;font-display:swap;font-weight:100 900;font-stretch:62% 125%;src:url(fonts/${FONT}) format('woff2-variations'),url(fonts/${FONT}) format('woff2')}</style>`);
if (/fonts\.googleapis|gstatic/.test(html)) throw new Error('index.html still loads something from Google');
writeFileSync(`${OUT}/index.html`, html);
console.log('Web app copied to www/');
