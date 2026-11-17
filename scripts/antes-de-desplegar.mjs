// =====================================================================
//  Control antes de publicar en Ferozo:  npm run verificar
//  Con --subir-version además pone un ?v= nuevo en index.html
//  (AAAAMMDD.N) para que los navegadores bajen los archivos nuevos.
//  No toca Supabase ni Ferozo: solo revisa la carpeta.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const errores = [], avisos = [], ok = [];

// ---------- Versión de los archivos en index.html ----------
let index = leer('index.html');
if (process.argv.includes('--subir-version')) {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Cordoba' }).replace(/-/g, '');
  const actuales = [...index.matchAll(/\?v=(\d{8})\.(\d+)/g)];
  const mismoDia = actuales.filter(m => m[1] === hoy).map(m => Number(m[2]));
  const nueva = `${hoy}.${mismoDia.length ? Math.max(...mismoDia) + 1 : 1}`;
  index = index.replace(/\?v=\d{8}\.\d+/g, '?v=' + nueva);
  fs.writeFileSync(path.join(RAIZ, 'index.html'), index);
  ok.push(`Versión de los archivos cambiada a ?v=${nueva}`);
}
const versiones = [...new Set([...index.matchAll(/\?v=([\d.]+)/g)].map(m => m[1]))];
if (versiones.length !== 1) errores.push(`index.html tiene versiones distintas (${versiones.join(', ')}): todas las líneas tienen que llevar el mismo ?v=`);
else ok.push(`Todos los archivos con ?v=${versiones[0]}`);

// Archivos que carga la página: tienen que existir
const locales = [...index.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"?]+)/g)].map(m => m[1]);
const faltan = locales.filter(f => !fs.existsSync(path.join(RAIZ, f)));
if (faltan.length) errores.push('index.html pide archivos que no existen: ' + faltan.join(', '));
else ok.push(`Los ${locales.length} archivos que carga index.html existen`);

// ---------- Conexión con Supabase ----------
const config = leer('js/config.js');
if (!/supabaseUrl:\s*"https:\/\/[a-z0-9]+\.supabase\.co"/.test(config)) errores.push('js/config.js: falta la Project URL de Supabase');
if (!/supabaseKey:\s*"sb_publishable_[\w-]+"/.test(config)) errores.push('js/config.js: falta la clave publishable (sb_publishable_…)');
if (!errores.some(e => e.startsWith('js/config.js'))) ok.push('js/config.js con URL y clave publishable');

// ---------- Nada secreto en lo que se publica ----------
const publicos = ['index.html', 'robots.txt', ...fs.readdirSync(path.join(RAIZ, 'css')).map(f => 'css/' + f)];
const recorrer = d => fs.readdirSync(path.join(RAIZ, d), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? recorrer(path.join(d, e.name)) : [path.join(d, e.name).replace(/\\/g, '/')]);
publicos.push(...recorrer('js'));
const SECRETOS = [/sb_secret_[\w-]+/, /service_role/i, /eyJhbGciOi[\w-]{20,}\.[\w-]{20,}/, /TIENDANUBE_TOKEN\s*[:=]\s*["'][^"']+/, /ODOO_API_KEY\s*[:=]\s*["'][^"']+/, /bearer\s+[0-9a-f]{40}/i, /["'][0-9a-f]{40}["']/, /ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}/];
for (const f of publicos) {
  const t = leer(f);
  for (const re of SECRETOS) if (re.test(t)) errores.push(`${f} parece tener un secreto (${re.source.slice(0, 20)}…): no se puede publicar`);
}
if (!errores.some(e => e.includes('secreto'))) ok.push(`Sin claves secretas en los ${publicos.length} archivos públicos`);

// ---------- Modo demo solo en la PC ----------
const main = leer('js/main.js');
if (!/localhost\|127\\\.0\\\.0\\\.1/.test(main)) errores.push('js/main.js: el modo demo tiene que funcionar solo en localhost');
else ok.push('Modo demo limitado a localhost');

// ---------- .htaccess ----------
const ht = fs.existsSync(path.join(RAIZ, '.htaccess')) ? leer('.htaccess') : '';
if (!ht) errores.push('Falta .htaccess');
else if (!/supabase\|pruebas/.test(ht) || !/\\\.git/.test(ht)) errores.push('.htaccess no bloquea supabase/, pruebas/ o .git');
else ok.push('.htaccess bloquea lo interno');

// ---------- Git ----------
try {
  const estado = execSync('git status --porcelain', { cwd: RAIZ, encoding: 'utf8' }).trim();
  if (estado) avisos.push(`Hay ${estado.split('\n').length} archivos sin commit: Ferozo publica lo que está en GitHub, no lo de esta carpeta`);
  else ok.push('Todo commiteado');
} catch (e) { avisos.push('No se pudo revisar git: ' + e.message); }

// ---------- Recordatorios de Supabase ----------
const migraciones = fs.readdirSync(path.join(RAIZ, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).sort();
avisos.push(`Migraciones (correr en orden en el SQL Editor de la base de RÓTULOS si falta alguna): ${migraciones.join(', ')}`);

console.log('\nAntes de desplegar en Ferozo\n');
ok.forEach(t => console.log('  OK      ' + t));
avisos.forEach(t => console.log('  OJO     ' + t));
errores.forEach(t => console.log('  ERROR   ' + t));
console.log(errores.length ? `\n${errores.length} error(es): corregir antes de publicar.\n` : '\nListo para publicar (revisá los OJO).\n');
process.exit(errores.length ? 1 : 0);
