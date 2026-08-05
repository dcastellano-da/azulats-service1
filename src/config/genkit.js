import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';

let ai;
let modelRef;

if (process.env.NODE_ENV === 'test') {
  console.log('⚠️ [TEST] Cargando Mocks en memoria para Firebase Genkit & Vertex AI');
  ai = {
    async generate(options) {
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

