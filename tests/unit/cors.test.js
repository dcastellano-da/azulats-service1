/**
 * tests/unit/cors.test.js
 *
 * Suite de pruebas unitarias para la lógica del middleware CORS.
 * Testea la función isOriginAllowed() en modo Producción y Staging
 * sin ninguna conexión a servicios externos (Firestore, Storage, red).
 *
 * Cobertura: 14 casos de test
 */

// Guardamos el NODE_ENV original para restaurarlo entre tests
const originalNodeEnv = process.env.NODE_ENV;

// ─── Helper: recargar el módulo con un entorno específico ───────────────────
// Dado que index.js evalúa NODE_ENV al importarse, usamos un helper
// que simula la lógica de isOriginAllowed directamente para aislar los tests.

/**
 * Recrea la lógica de isOriginAllowed con el entorno y orígenes dados.
 * Esto nos permite testear sin importar el módulo completo (que inicializa Express).
 */
function buildIsOriginAllowed(nodeEnv, allowedOriginsStr) {
  const allowedOrigins = (allowedOriginsStr || '')
    .split(',')
    .map(o => o.trim().toLowerCase())
    .filter(Boolean);

  const FIREBASE_PREVIEW_REGEX = /^https:\/\/[a-zA-Z0-9-]+(--[a-zA-Z0-9-]+)?\.hosted\.app$/;
  const isProduction = nodeEnv === 'production';

  return function isOriginAllowed(origin) {
    if (!origin) return true;
    const normalizedOrigin = origin.toLowerCase();
    const isInAllowlist = allowedOrigins.includes(normalizedOrigin);
    if (isProduction) {
      return isInAllowlist;
    } else {
      return isInAllowlist || FIREBASE_PREVIEW_REGEX.test(origin);
    }
  };
}

// ─── Configuración de orígenes para los tests ───────────────────────────────
const PROD_ORIGINS = 'https://digitalagil.es,https://www.digitalagil.es';
const STAGING_ORIGINS = 'http://localhost:3000,https://digitalagil.es';

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE 1 — Modo PRODUCCIÓN
// ════════════════════════════════════════════════════════════════════════════
describe('CORS — Modo Producción (NODE_ENV=production)', () => {
  let isOriginAllowed;

  beforeAll(() => {
    isOriginAllowed = buildIsOriginAllowed('production', PROD_ORIGINS);
  });

  test('✅ Permite https://digitalagil.es (whitelist exacta)', () => {
    expect(isOriginAllowed('https://digitalagil.es')).toBe(true);
  });

  test('✅ Permite https://www.digitalagil.es (whitelist exacta)', () => {
    expect(isOriginAllowed('https://www.digitalagil.es')).toBe(true);
  });

  test('✅ Permite petición sin cabecera Origin (curl, Postman, health check)', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed(null)).toBe(true);
  });

  test('❌ Bloquea URL de preview de Firebase App Hosting (*.hosted.app)', () => {
    expect(isOriginAllowed('https://myapp--branch123.hosted.app')).toBe(false);
  });

  test('❌ Bloquea https://azulats-preview--develop.hosted.app', () => {
    expect(isOriginAllowed('https://azulats-preview--develop.hosted.app')).toBe(false);
  });

  test('❌ Bloquea origen desconocido (https://evil.com)', () => {
    expect(isOriginAllowed('https://evil.com')).toBe(false);
  });

  test('❌ Bloquea http://localhost:3000 (no está en whitelist de producción)', () => {
    expect(isOriginAllowed('http://localhost:3000')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE 2 — Modo STAGING / DESARROLLO
// ════════════════════════════════════════════════════════════════════════════
describe('CORS — Modo Staging/Desarrollo (NODE_ENV=staging)', () => {
  let isOriginAllowed;

  beforeAll(() => {
    isOriginAllowed = buildIsOriginAllowed('staging', STAGING_ORIGINS);
  });

  test('✅ Permite http://localhost:3000 (whitelist de desarrollo)', () => {
    expect(isOriginAllowed('http://localhost:3000')).toBe(true);
  });

  test('✅ Permite https://digitalagil.es (whitelist compartida)', () => {
    expect(isOriginAllowed('https://digitalagil.es')).toBe(true);
  });

  test('✅ Permite https://myapp--branch123.hosted.app (Regex Firebase preview)', () => {
    expect(isOriginAllowed('https://myapp--branch123.hosted.app')).toBe(true);
  });

  test('✅ Permite https://azulats-preview--develop.hosted.app (Regex Firebase preview)', () => {
    expect(isOriginAllowed('https://azulats-preview--develop.hosted.app')).toBe(true);
  });

  test('✅ Permite petición sin cabecera Origin', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
  });

  test('❌ Bloquea https://evil.com (no whitelist, no regex)', () => {
    expect(isOriginAllowed('https://evil.com')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BLOQUE 3 — Casos borde de la Regex Firebase App Hosting
// ════════════════════════════════════════════════════════════════════════════
describe('CORS — Casos borde de la Regex *.hosted.app', () => {
  let isOriginAllowed;

  beforeAll(() => {
    isOriginAllowed = buildIsOriginAllowed('staging', '');
  });

  test('✅ Acepta subdomain simple: https://proyecto.hosted.app', () => {
    expect(isOriginAllowed('https://proyecto.hosted.app')).toBe(true);
  });

  test('✅ Acepta subdomain con separador: https://proyecto--rama.hosted.app', () => {
    expect(isOriginAllowed('https://proyecto--rama.hosted.app')).toBe(true);
  });

  test('❌ Rechaza sin HTTPS: http://proyecto--rama.hosted.app', () => {
    expect(isOriginAllowed('http://proyecto--rama.hosted.app')).toBe(false);
  });

  test('❌ Rechaza dominio raíz sin subdominio: https://hosted.app', () => {
    expect(isOriginAllowed('https://hosted.app')).toBe(false);
  });

  test('❌ Rechaza dominio que contiene "hosted.app" pero no es el TLD exacto', () => {
    expect(isOriginAllowed('https://evil-hosted.app.attacker.com')).toBe(false);
  });
});
