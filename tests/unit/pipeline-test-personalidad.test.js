import { z } from 'zod';

const TestPersonalidadSchema = z.object({
  arquetipo_codigo: z.string(),
  arquetipo_nombre: z.string(),
  dimensiones: z.object({
    dim_mente: z.number().min(0).max(100),
    dim_energia: z.number().min(0).max(100),
    dim_naturaleza: z.number().min(0).max(100),
    dim_tactica: z.number().min(0).max(100),
    dim_identidad: z.number().min(0).max(100)
  }),
  analisis_encaje: z.string()
});

describe('Esquema de Validación Zod — Test de Personalidad / CFV - V3 (test_personalidad)', () => {
  test('Valida correctamente un objeto test_personalidad completo dentro del rango 0-100', () => {
    const validSample = {
      arquetipo_codigo: 'ENTJ-A',
      arquetipo_nombre: 'Comandante',
      dimensiones: {
        dim_mente: 35,
        dim_energia: 78,
        dim_naturaleza: 82,
        dim_tactica: 90,
        dim_identidad: 85
      },
      analisis_encaje: 'Perfil altamente compatible con roles de liderazgo técnico.'
    };

    const parseResult = TestPersonalidadSchema.safeParse(validSample);
    expect(parseResult.success).toBe(true);
    expect(parseResult.data.arquetipo_codigo).toBe('ENTJ-A');
    expect(parseResult.data.dimensiones.dim_mente).toBe(35);
  });

  test('Rechaza dimensiones numéricas con valores negativos (< 0)', () => {
    const invalidSample = {
      arquetipo_codigo: 'INFP-T',
      arquetipo_nombre: 'Mediador',
      dimensiones: {
        dim_mente: -5, // Inválido (< 0)
        dim_energia: 50,
        dim_naturaleza: 50,
        dim_tactica: 50,
        dim_identidad: 50
      },
      analisis_encaje: 'Prueba con valor negativo.'
    };

    const parseResult = TestPersonalidadSchema.safeParse(invalidSample);
    expect(parseResult.success).toBe(false);
  });

  test('Rechaza dimensiones numéricas con valores superiores a 100 (> 100)', () => {
    const invalidSample = {
      arquetipo_codigo: 'ESTJ-A',
      arquetipo_nombre: 'Ejecutivo',
      dimensiones: {
        dim_mente: 50,
        dim_energia: 150, // Inválido (> 100)
        dim_naturaleza: 50,
        dim_tactica: 50,
        dim_identidad: 50
      },
      analisis_encaje: 'Prueba con valor superior a 100.'
    };

    const parseResult = TestPersonalidadSchema.safeParse(invalidSample);
    expect(parseResult.success).toBe(false);
  });

  test('Rechaza objetos a los que les faltan dimensiones o campos requeridos', () => {
    const incompleteSample = {
      arquetipo_codigo: 'INTJ-A',
      dimensiones: {
        dim_mente: 50
      }
    };

    const parseResult = TestPersonalidadSchema.safeParse(incompleteSample);
    expect(parseResult.success).toBe(false);
  });
});
