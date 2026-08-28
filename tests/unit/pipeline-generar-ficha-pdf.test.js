import { z } from 'zod';
import { generarHtmlFichaPdf, renderizarPdfFromHtml } from '../../src/services/pdfService.js';

const GenerarFichaSchema = z.object({
  incluir_test_personalidad: z.boolean().optional().default(true),
  incluir_pretension_salarial: z.boolean().optional().default(true),
  incluir_notas_assessment: z.boolean().optional().default(true),
  incluir_bitacora: z.boolean().optional().default(true),
  incluir_trayectoria: z.boolean().optional().default(true),
  anonimizar_candidato: z.boolean().optional().default(false)
});

describe('Módulo de Generación de Ficha Técnica PDF — Servicios y Validaciones', () => {

  describe('Esquema de Validación de Opciones Pre-Generación (GenerarFichaSchema)', () => {
    test('Acepta un objeto de opciones completo y asigna valores por defecto', () => {
      const parseResult = GenerarFichaSchema.safeParse({});
      expect(parseResult.success).toBe(true);
      expect(parseResult.data.incluir_test_personalidad).toBe(true);
      expect(parseResult.data.incluir_bitacora).toBe(true);
      expect(parseResult.data.anonimizar_candidato).toBe(false);
    });

    test('Valida opciones personalizadas enviadas desde el modal de la UI', () => {
      const payload = {
        incluir_test_personalidad: false,
        incluir_pretension_salarial: true,
        incluir_bitacora: true,
        anonimizar_candidato: true
      };

      const parseResult = GenerarFichaSchema.safeParse(payload);
      expect(parseResult.success).toBe(true);
      expect(parseResult.data.incluir_test_personalidad).toBe(false);
      expect(parseResult.data.anonimizar_candidato).toBe(true);
    });

    test('Rechaza valores que no sean booleanos', () => {
      const payload = {
        incluir_bitacora: 'si_por_favor'
      };

      const parseResult = GenerarFichaSchema.safeParse(payload);
      expect(parseResult.success).toBe(false);
    });
  });

  describe('Generación de HTML y Consolidación de Datos (generarHtmlFichaPdf)', () => {
    const mockDatos = {
      agencia: {
        nombre_comercial: 'Consultora RH Prime',
        logo_url: 'https://storage.googleapis.com/logo.png',
        color_primario: '#003366'
      },
      busqueda: {
        perfil_tecnico: { rol_solicitado: 'Senior Backend Developer' },
        identificacion: { cliente: 'Banco Santander' }
      },
      postulante: {
        id: 'cand-uuid-123456',
        nombre: 'Carlos Mendoza',
        email: 'carlos@example.com',
        telefono_movil: '+34 600 111 222',
        ubicacion: 'Madrid, España',
        nivel_ingles: 'C1 Avanzado',
        resumen: 'Desarrollador con 8 años de experiencia en Node.js.',
        skills_principales: 'Node.js, Express, Jest, Cloud Run',
        rubros: 'Banca, Fintech'
      },
      pipeline: {
        f1_descubrimiento: {
          notas_reclutador: 'Nota F1: Perfil altamente motivado y con gran encaje.'
        },
        f2_evaluacion: {
          notas_reclutador: 'Nota F2: Evaluación técnica aprobada con 90 puntos.',
          assessment_manual: {
            resumen_texto: 'Demuestra solidez en arquitecturas distribuidas.',
            fecha_evaluacion: '2026-08-27T10:00:00Z'
          },
          informe_entrevista_ia: {
            pretension_economica_condiciones: {
              pretension_salarial: '55.000 EUR brutos anuales',
              modalidad_preferida: 'Híbrida',
              disponibilidad: 'Preaviso 2 semanas'
            }
          },
          test_personalidad: {
            arquetipo_nombre: 'Comandante',
            arquetipo_codigo: 'ENTJ-A',
            dimensiones: {
              dim_mente: 40,
              dim_energia: 80,
              dim_naturaleza: 75,
              dim_tactica: 90,
              dim_identidad: 85
            },
            analisis_encaje: 'Liderazgo sólido y enfoque a resultados.'
          }
        },
        f3_cliente: {
          notas_reclutador: 'Nota F3: Cliente muy satisfecho tras la entrevista técnica.'
        },
        f4_cierre: {
          notas_reclutador: 'Nota F4: Oferta formal enviada y aceptada.'
        }
      },
      resumenEjecutivoIA: 'Carlos es un perfil altamente calificado con amplia experiencia en arquitecturas bancarias.'
    };

    test('Consolida la bitácora del reclutador incluyendo las notas de TODAS las fases (F1 a F4)', async () => {
      const html = await generarHtmlFichaPdf(mockDatos, { incluir_bitacora: true });

      expect(html).toContain('Bitácora de Notas del Reclutador (Fases F1 a F4)');
      expect(html).toContain('Nota F1: Perfil altamente motivado');
      expect(html).toContain('Nota F2: Evaluación técnica aprobada');
      expect(html).toContain('Nota F3: Cliente muy satisfecho');
      expect(html).toContain('Nota F4: Oferta formal enviada');
    });

    test('Anonimiza la información del candidato cuando anonimizar_candidato es true', async () => {
      const html = await generarHtmlFichaPdf(mockDatos, { anonimizar_candidato: true });

      expect(html).not.toContain('Carlos Mendoza');
      expect(html).not.toContain('carlos@example.com');
      expect(html).not.toContain('+34 600 111 222');
      expect(html).toContain('Candidato #CAND-UUI');
    });

    test('Omite bloques cuando sus opciones correspondientes son false', async () => {
      const html = await generarHtmlFichaPdf(mockDatos, {
        incluir_test_personalidad: false,
        incluir_pretension_salarial: false,
        incluir_bitacora: false
      });

      expect(html).not.toContain('Perfil Psicométrico');
      expect(html).not.toContain('55.000 EUR');
      expect(html).not.toContain('Bitácora de Notas del Reclutador');
    });

    test('Incluye el branding de la agencia y el sello Powered by Azul ATS', async () => {
      const html = await generarHtmlFichaPdf(mockDatos, { incluir_bitacora: true });

      expect(html).toContain('Consultora RH Prime');
      expect(html).toContain('Banco Santander');
      expect(html).toContain('Powered by Azul ATS');
    });
  });

  describe('Renderizado de Buffer PDF (renderizarPdfFromHtml) y Manejo de Errores de Infraestructura', () => {
    test('Devuelve un Buffer de datos binarios no vacío al renderizar el HTML', async () => {
      const htmlSample = '<html><body><h1>Ficha PDF Test</h1></body></html>';
      const pdfBuffer = await renderizarPdfFromHtml(htmlSample);

      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(0);
    });

    test('Captura errores de arranque y lanza una excepción estructurada de infraestructura para binario faltante', async () => {
      // Simular fallo de entorno fuera del mock de test
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      process.env.PUPPETEER_EXECUTABLE_PATH = '/ruta/inexistente/chrome_binario_fake';

      try {
        await renderizarPdfFromHtml('<html></html>');
        // Si no falla, lanzar error inesperado
        expect(true).toBe(false);
      } catch (err) {
        expect(err.isPuppeteerLaunchError).toBe(true);
        expect(err.message).toContain('Error de infraestructura: Motor de renderizado PDF no disponible (Falta binario de Chrome)');
      } finally {
        process.env.NODE_ENV = originalEnv;
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
      }
    });
  });

});
