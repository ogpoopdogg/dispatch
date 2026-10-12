// Copies the web app (index.html + icons) into www/ for the Capacitor app,
// and adds the Capacitor runtime so the page can reach native plugins.
// The root index.html stays a plain web page that also works in a browser.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const OUT = 'www';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const f of ['icon2.png', 'icon-512.png']) {
  if (existsSync(f)) cpSync(f, `${OUT}/${f}`);
}
cpSync('node_modules/@capacitor/core/dist/capacitor.js', `${OUT}/capacitor.js`);

const MARK = '<!-- capacitor runtime -->';
const html = readFileSync('index.html', 'utf8');
if (!html.includes(MARK)) throw new Error(`index.html is missing the "${MARK}" marker`);
writeFileSync(`${OUT}/index.html`, html.replace(MARK, '<script src="capacitor.js"></script>'));
console.log('Web app copied to www/');
