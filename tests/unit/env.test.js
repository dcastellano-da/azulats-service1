/**
 * tests/unit/env.test.js
 *
 * Smoke test de configuración de variables de entorno.
 * Verifica que las variables mínimas requeridas para el arranque
 * del servicio están presentes. No conecta a ningún servicio externo.
 *
 * En CI/CD estas variables se inyectan desde los GitHub Secrets.
 * En local se leen desde el archivo .env.
 */

// Cargamos dotenv manualmente en el contexto del test
// para asegurar que .env está disponible en entorno local
import { config } from 'dotenv';
config();

describe('Variables de Entorno — Smoke Test', () => {

  // ── Variables requeridas en todos los entornos ──────────────────────────
  describe('Variables requeridas (todos los entornos)', () => {

    test('GOOGLE_CLOUD_PROJECT debe estar definida y no vacía', () => {
      const value = process.env.GOOGLE_CLOUD_PROJECT;
      expect(value).toBeDefined();
      expect(value.trim()).not.toBe('');
    });

    test('FIREBASE_STORAGE_BUCKET debe estar definida y no vacía', () => {
      const value = process.env.FIREBASE_STORAGE_BUCKET;
      expect(value).toBeDefined();
      expect(value.trim()).not.toBe('');
    });

  });

  // ── Variables requeridas solo en Producción ──────────────────────────────
  describe('Variables de Producción (cuando NODE_ENV=production)', () => {

    test('Si NODE_ENV=production, ALLOWED_ORIGINS debe estar definida', () => {
      if (process.env.NODE_ENV === 'production') {
        const value = process.env.ALLOWED_ORIGINS;
        expect(value).toBeDefined();
        expect(value.trim()).not.toBe('');
      } else {
        // En entornos no productivos, este test pasa incondicionalmente
        expect(true).toBe(true);
      }
    });

    test('Si NODE_ENV=production, ALLOWED_ORIGINS no debe contener comodines (*)', () => {
      if (process.env.NODE_ENV === 'production') {
        const value = process.env.ALLOWED_ORIGINS || '';
        expect(value).not.toContain('*');
      } else {
        expect(true).toBe(true);
      }
    });

  });

  // ── Validaciones de formato ──────────────────────────────────────────────
  describe('Validaciones de formato', () => {

    test('FIREBASE_STORAGE_BUCKET debe terminar en .firebasestorage.app o .appspot.com', () => {
      const value = process.env.FIREBASE_STORAGE_BUCKET || '';
      const isValid =
        value.endsWith('.firebasestorage.app') ||
        value.endsWith('.appspot.com');
      expect(isValid).toBe(true);
    });

    test('PORT (si está definido) debe ser un número entre 1024 y 65535', () => {
      const portStr = process.env.PORT;
      if (portStr) {
        const port = parseInt(portStr, 10);
        expect(Number.isInteger(port)).toBe(true);
        expect(port).toBeGreaterThanOrEqual(1024);
        expect(port).toBeLessThanOrEqual(65535);
      } else {
        expect(true).toBe(true); // PORT es opcional; el servicio usa 8080 por defecto
      }
    });

  });

});
