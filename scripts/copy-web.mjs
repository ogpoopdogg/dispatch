// Copies the web app (index.html + icons) into www/ for the Capacitor app,
// as www/app.html, with a small starter page (scripts/live-loader.html) as www/index.html that
// runs newer screens downloaded after a merge to main (see "Updates without a new APK" in APP-SETUP.md).
// and adds the Capacitor runtime so the page can reach native plugins.
// Firebase and the Archivo font are packed into the app too, so it starts without
// waiting on the internet. The root index.html stays a plain web page that also works in a browser.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const OUT = 'www';
// Raise NATIVE_API by 1 whenever a change needs a new APK (anything in android/, a new Capacitor
// plugin, a new permission). Phones then keep their current screens until the new APK is installed.
const NATIVE_API = 1;
const BUILD = Number(process.env.GITHUB_RUN_NUMBER || 0);
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
html = swap(html, 'https://www.gstatic.com/firebasejs/12.19.0/', 'vendor/');
html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>\n?/g, '');
html = swap(html, '<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap" rel="stylesheet" media="print" onload="this.media=\'all\'">',
  `<link rel="preload" href="fonts/${FONT}" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'Archivo';font-style:normal;font-display:swap;font-weight:100 900;font-stretch:62% 125%;src:url(fonts/${FONT}) format('woff2-variations'),url(fonts/${FONT}) format('woff2')}</style>`);
if (/fonts\.googleapis|gstatic/.test(html)) throw new Error('index.html still loads something from Google');
html = swap(html, '<meta charset="UTF-8">', `<meta charset="UTF-8">\n<meta name="ecd-build" content="${BUILD}">\n<meta name="ecd-native" content="${NATIVE_API}">`);
writeFileSync(`${OUT}/app.html`, html);
const loader = readFileSync('scripts/live-loader.html', 'utf8');
writeFileSync(`${OUT}/index.html`, swap(swap(loader, '__BUILD__', String(BUILD)), '__NATIVE__', String(NATIVE_API)));
console.log(`Web app copied to www/ (build ${BUILD}, native ${NATIVE_API})`);
