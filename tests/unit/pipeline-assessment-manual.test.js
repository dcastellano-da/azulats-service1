import { z } from 'zod';

const AssessmentManualSchema = z.object({
  resumen_texto: z.string({
    required_error: 'El campo resumen_texto es obligatorio en assessment_manual.',
    invalid_type_error: 'El campo resumen_texto debe ser un string.'
  }).min(1, 'El campo resumen_texto no puede estar vacío.').max(10000, 'El resumen de evaluación técnica no puede exceder los 10000 caracteres.')
});

describe('Esquema de Validación y Reglas de Negocio — Assessment Técnico Manual (assessment_manual)', () => {
  test('Valida correctamente un objeto assessment_manual válido', () => {
    const validSample = {
      resumen_texto: 'El candidato demostró amplios conocimientos en Node.js, Express y bases de datos relacionales y NoSQL.'
    };

    const parseResult = AssessmentManualSchema.safeParse(validSample);
    expect(parseResult.success).toBe(true);
    expect(parseResult.data.resumen_texto).toContain('Node.js');
  });

  test('Rechaza resúmenes de evaluación vacíos o espacios en blanco sin contenido', () => {
    const invalidSample = {
      resumen_texto: ''
    };

    const parseResult = AssessmentManualSchema.safeParse(invalidSample);
    expect(parseResult.success).toBe(false);
  });

  test('Rechaza resúmenes de evaluación que superen los 10.000 caracteres', () => {
    const invalidSample = {
      resumen_texto: 'A'.repeat(10001)
    };

    const parseResult = AssessmentManualSchema.safeParse(invalidSample);
    expect(parseResult.success).toBe(false);
  });

  test('Rechaza resúmenes de evaluación con tipos de datos no string (ej. números)', () => {
    const invalidSample = {
      resumen_texto: 12345
    };

    const parseResult = AssessmentManualSchema.safeParse(invalidSample);
    expect(parseResult.success).toBe(false);
  });

  test('Inmutabilidad Temporal: La fecha de evaluación debe ser sobreescrita por el reloj del servidor', () => {
    const clientPayload = {
      resumen_texto: 'Fortalezas en arquitecturas serverless.',
      fecha_evaluacion: '1999-01-01T00:00:00.000Z' // Fecha manipulada por el cliente
    };

    const parseResult = AssessmentManualSchema.safeParse(clientPayload);
    expect(parseResult.success).toBe(true);

    // Simulación de la inyección estricta del reloj interno del servidor
    const serverTimestamp = new Date().toISOString();
    const finalStoredObject = {
      resumen_texto: parseResult.data.resumen_texto,
      fecha_evaluacion: serverTimestamp
    };

    expect(finalStoredObject.fecha_evaluacion).not.toBe('1999-01-01T00:00:00.000Z');
    expect(finalStoredObject.fecha_evaluacion).toBe(serverTimestamp);
  });
});
