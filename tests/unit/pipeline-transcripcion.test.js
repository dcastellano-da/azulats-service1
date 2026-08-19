import { z } from 'zod';

const InformeEntrevistaSchema = z.object({
  experiencia_consolidada: z.string(),
  alineacion_motivadores: z.string(),
  pretension_economica_condiciones: z.object({
    pretension_salarial: z.string().nullable(),
    disponibilidad: z.string().nullable(),
    modalidad_preferida: z.string().nullable()
  }),
  proximos_pasos: z.array(z.string()),
  auditoria_veracidad: z.object({
    inconsistencias_detectadas: z.array(z.string()),
    confirmaciones_fortalezas: z.array(z.string())
  })
});

describe('Esquema de Validación Zod — Informe de Entrevista de Screening (informe_entrevista_ia)', () => {
  test('Valida correctamente una estructura completa de informe_entrevista_ia', () => {
    const validSample = {
      experiencia_consolidada: 'El candidato cuenta con 6 años de experiencia en logística.',
      alineacion_motivadores: 'Busca oportunidades de crecimiento y proyectos desafiantes.',
      pretension_economica_condiciones: {
        pretension_salarial: '50.000 EUR brutos anuales',
        disponibilidad: 'Preaviso de 15 días',
        modalidad_preferida: 'Híbrida'
      },
      proximos_pasos: ['Enviar prueba técnica', 'Coordinar entrevista con Hiring Manager'],
      auditoria_veracidad: {
        inconsistencias_detectadas: ['La fecha de egreso del último rol difiere en 2 meses con el CV.'],
        confirmaciones_fortalezas: ['Demuestra conocimientos avanzados de Node.js y arquitecturas cloud.']
      }
    };

    const parseResult = InformeEntrevistaSchema.safeParse(validSample);
    expect(parseResult.success).toBe(true);
    expect(parseResult.data.experiencia_consolidada).toContain('logística');
    expect(parseResult.data.proximos_pasos.length).toBe(2);
  });

  test('Acepta valores nulos en los subcampos opcionales de pretension_economica_condiciones', () => {
    const sampleWithNulls = {
      experiencia_consolidada: 'Perfil Junior con experiencia inicial.',
      alineacion_motivadores: 'Interés en desarrollo profesional.',
      pretension_economica_condiciones: {
        pretension_salarial: null,
        disponibilidad: null,
        modalidad_preferida: null
      },
      proximos_pasos: [],
      auditoria_veracidad: {
        inconsistencias_detectadas: [],
        confirmaciones_fortalezas: []
      }
    };

    const parseResult = InformeEntrevistaSchema.safeParse(sampleWithNulls);
    expect(parseResult.success).toBe(true);
  });

  test('Rechaza estructuras incompletas a las que les faltan bloques requeridos', () => {
    const invalidSample = {
      experiencia_consolidada: 'Resumen incompleto'
      // Faltan alineacion_motivadores, pretension_economica_condiciones, etc.
    };

    const parseResult = InformeEntrevistaSchema.safeParse(invalidSample);
    expect(parseResult.success).toBe(false);
  });
});
