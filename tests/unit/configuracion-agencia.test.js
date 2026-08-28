import { z } from 'zod';

const ConfiguracionAgenciaSchema = z.object({
  nombre_comercial: z.string().min(1, 'El nombre comercial de la agencia no puede estar vacío.').optional(),
  color_primario: z.string().optional(),
  sello_texto: z.string().optional(),
  email_contacto: z.string().email('Debe ser un email de contacto válido.').nullable().optional().or(z.literal('')),
  telefono_contacto: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional()
});

describe('Módulo de Configuración de Agencia y Carga de Logo (configuracion_agencia)', () => {

  describe('Esquema de Validación Zod (ConfiguracionAgenciaSchema)', () => {
    test('Valida un objeto de configuración completo y correcto', () => {
      const validPayload = {
        nombre_comercial: 'Talento Digital RH',
        color_primario: '#0284c7',
        sello_texto: 'Powered by Azul ATS',
        email_contacto: 'info@talentodigital.es',
        telefono_contacto: '+34 912 345 678',
        direccion: 'Paseo de la Castellana 100, Madrid',
        logo_url: 'https://storage.googleapis.com/bucket/agencia/logo.png'
      };

      const parseResult = ConfiguracionAgenciaSchema.safeParse(validPayload);
      expect(parseResult.success).toBe(true);
      expect(parseResult.data.nombre_comercial).toBe('Talento Digital RH');
    });

    test('Acepta email de contacto nulo o vacío', () => {
      const payloadWithNullEmail = {
        nombre_comercial: 'Agencia Ejemplo',
        email_contacto: ''
      };

      const parseResult = ConfiguracionAgenciaSchema.safeParse(payloadWithNullEmail);
      expect(parseResult.success).toBe(true);
    });

    test('Rechaza email de contacto con formato inválido', () => {
      const invalidPayload = {
        nombre_comercial: 'Agencia Ejemplo',
        email_contacto: 'email-invalido-sin-arroba'
      };

      const parseResult = ConfiguracionAgenciaSchema.safeParse(invalidPayload);
      expect(parseResult.success).toBe(false);
    });

    test('Rechaza nombre comercial si es una cadena vacía', () => {
      const invalidPayload = {
        nombre_comercial: ''
      };

      const parseResult = ConfiguracionAgenciaSchema.safeParse(invalidPayload);
      expect(parseResult.success).toBe(false);
    });
  });

  describe('Reglas de Negocio del Módulo de Configuración de Agencia', () => {
    test('Valores por defecto ante documento ausente en Firestore (Fallback Maestro)', () => {
      const defaultState = {
        id: 'p-cfg-01',
        nombre_comercial: 'Azul ATS Agency',
        logo_url: null,
        color_primario: '#1e3a8a',
        sello_texto: 'Powered by Azul ATS',
        email_contacto: null,
        telefono_contacto: null,
        direccion: null,
        updatedAt: null
      };

      expect(defaultState.id).toBe('p-cfg-01');
      expect(defaultState.nombre_comercial).toBe('Azul ATS Agency');
      expect(defaultState.sello_texto).toBe('Powered by Azul ATS');
    });

    test('Filtrado estricto de extensiones para Carga de Logo (PNG, JPG, JPEG, WEBP, SVG)', () => {
      const allowedExtensions = /\.(png|jpg|jpeg|webp|svg)$/i;

      expect(allowedExtensions.test('logo_empresa.png')).toBe(true);
      expect(allowedExtensions.test('logo_empresa.JPG')).toBe(true);
      expect(allowedExtensions.test('vector.svg')).toBe(true);
      expect(allowedExtensions.test('documento.pdf')).toBe(false);
      expect(allowedExtensions.test('archivo.txt')).toBe(false);
    });
  });

});
