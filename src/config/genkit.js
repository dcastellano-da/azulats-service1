import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';

let ai;
let modelRef;

if (process.env.NODE_ENV === 'test') {
  console.log('⚠️ [TEST] Cargando Mocks en memoria para Firebase Genkit & Vertex AI');
  ai = {
    async generate(options) {
      // Si la llamada incluye el esquema de informe de entrevista de screening
      if (options.output?.schema?.shape?.experiencia_consolidada) {
        return {
          output: {
            experiencia_consolidada: 'El candidato cuenta con 6 años de experiencia en liderazgo de proyectos y gestión de operaciones.',
            alineacion_motivadores: 'Busca estabilidad profesional, buen clima laboral y oportunidad de aprendizaje en tecnologías cloud.',
            pretension_economica_condiciones: {
              pretension_salarial: '4.500 USD brutos mensuales',
              disponibilidad: 'Preaviso de 2 semanas',
              modalidad_preferida: 'Híbrida'
            },
            proximos_pasos: [
              'Notificar resultado al candidato',
              'Coordinar entrevista técnica con el equipo de arquitectura'
            ],
            auditoria_veracidad: {
              inconsistencias_detectadas: [
                'En la entrevista mencionó egreso en 2021, mientras que el CV especifica marzo de 2022.'
              ],
              confirmaciones_fortalezas: [
                'Demuestra solidez técnica comprobada en Express, Node.js y Cloud Run.'
              ]
            }
          }
        };
      }

      // Si la llamada incluye el esquema de evaluación de screening
      if (options.output?.schema?.shape?.evaluaciones) {
        return {
          output: {
            evaluaciones: [
              {
                id_criterio: 'crit_1',
                evaluacion: 'SI',
                evidencia_cv: 'Gerente de Operaciones Logísticas en Empresa X desde enero de 2018 hasta la actualidad (6 años).'
              },
              {
                id_criterio: 'crit_2',
                evaluacion: 'INFERIDO',
                evidencia_cv: 'Gestión de flotas y campamentos en zonas de alta montaña para proyectos extractivos.'
              }
            ]
          }
        };
      }

      // Si la llamada incluye el esquema de Test de Personalidad (CFV)
      if (options.output?.schema?.shape?.arquetipo_codigo) {
        return {
          output: {
            arquetipo_codigo: 'ENTJ-A',
            arquetipo_nombre: 'Comandante',
            dimensiones: {
              dim_mente: 35,
              dim_energia: 78,
              dim_naturaleza: 82,
              dim_tactica: 90,
              dim_identidad: 85
            },
            analisis_encaje: 'El perfil ENTJ-A demuestra alta capacidad de liderazgo y orientación estratégica ideal para la vacante.'
          }
        };
      }

      // Estructura por defecto para importación de candidatos
      return {
        output: {
          nombre_completo: 'Candidato de Prueba IA',
          email: 'ia.test@digitalagil.es',
          telefono_movil: '+5411223344',
          ubicacion: 'Buenos Aires, Argentina',
          skills_principales: 'Express, Node.js, Firebase',
          nivel_ingles: 'B2 Intermediate',
          otros_idiomas: 'Portugués',
          linkedin_url: 'https://linkedin.com/in/iatest',
          notas_iniciales: 'Perfil extraído automáticamente usando entorno simulado de IA.',
          resumen: 'Desarrollador fullstack con 5 años de experiencia liderando proyectos web.',
          rubros: 'Finanzas, Minería, Automotriz'
        }
      };
    }
  };
  modelRef = 'mock-model';
} else {
  ai = genkit({
    plugins: [
      vertexAI({
        projectId: 'ultra-bearing-492817-k6',
        location: 'us-east1'
      })
    ]
  });
  modelRef = 'vertexai/gemini-2.5-flash';
}

export { ai, modelRef };

