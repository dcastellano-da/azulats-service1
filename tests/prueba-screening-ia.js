import { Buffer } from 'buffer';

const PORT = process.env.PORT || 8080;
const BASE_URL = `http://localhost:${PORT}/api/v1/pipeline`;
const CANDIDATOS_URL = `http://localhost:${PORT}/api/v1/candidatos`;
const BUSQUEDAS_URL = `http://localhost:${PORT}/api/v1/busquedas`;

async function runTestCase(name, options, expectedStatus) {
  console.log(`\n========================================`);
  console.log(`TEST: ${name}`);
  console.log(`========================================`);
  try {
    const response = await fetch(options.url || BASE_URL, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const status = response.status;
    const body = await response.json();

    console.log(`Status devuelto: ${status} (Esperado: ${expectedStatus})`);
    console.log(`Cuerpo de respuesta:`, JSON.stringify(body, null, 2));

    if (status === expectedStatus) {
      console.log(`✅ RESULTADO: PASÓ COMPROBACIÓN`);
      return { success: true, body };
    } else {
      console.error(`❌ RESULTADO: FALLÓ COMPROBACIÓN`);
      return { success: false, body };
    }
  } catch (error) {
    console.error(`❌ Error al conectar con el servidor:`, error.message);
    return { success: false, error };
  }
}

async function start() {
  console.log('Iniciando batería de pruebas para Motor de Screening con IA (Etapa 2)...');

  // 1. Crear Búsqueda con criterios de screening dinámicos
  console.log('Creando búsqueda REQ-SCREENING-IA...');
  const searchBody = {
    id_busqueda: 'REQ-SCREENING-IA',
    identificacion: {
      cliente: 'Empresa Logística SA',
      hiring_manager: 'Roberto Gómez',
      fecha_apertura: '2026-07-28T00:00:00Z'
    },
    perfil_tecnico: {
      rol_solicitado: 'Gerente de Operaciones Logísticas',
      seniority: 'Senior'
    },
    estado_sla: {
      estado_busqueda: 'Abierta'
    },
    criterios_screening: [
      {
        id: 'crit_1',
        pregunta: '¿Tiene al menos 5 años de experiencia liderando operaciones logísticas?',
        tipo: 'knockout',
        peso: 0
      },
      {
        id: 'crit_2',
        pregunta: '¿Tiene experiencia comprobable en el rubro de la Minería?',
        tipo: 'deseable',
        peso: 30
      }
    ]
  };

  const searchRes = await fetch(BUSQUEDAS_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(searchBody)
  });
  if (searchRes.status !== 201) {
    console.error('Error al preparar búsqueda para test de screening IA');
    process.exit(1);
  }
  console.log('Búsqueda REQ-SCREENING-IA creada con 2 criterios de screening.');

  // 2. Crear candidato con CV cargado
  console.log('Creando candidato Abel Tapia con CV PDF...');
  const formData = new FormData();
  const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Size 1 >>\nstartxref\n10\n%%EOF');
  formData.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'cv_abel_tapia.pdf');
  formData.append('nombre_completo', 'Abel Tapia');
  formData.append('email', 'abel.tapia@empresa.com');
  formData.append('acepta_privacidad', 'true');

  const candRes = await fetch(CANDIDATOS_URL, {
    method: 'POST',
    body: formData
  });
  const candData = await candRes.json();
  const candId = candData.data.id;
  console.log(`Candidato registrado con ID: ${candId}`);

  // 3. Vincular al pipeline
  const pipeRes = await runTestCase('Vincular candidato al pipeline', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: {
      id_busqueda: 'REQ-SCREENING-IA',
      id_candidato: candId
    }
  }, 201);

  const pipelineId = pipeRes.body.data.id;

  // 4. Invocación de Inferencia IA: POST /api/v1/pipeline/:id/evaluar-screening
  const evalRes = await runTestCase('Invocación de evaluación de screening con IA (Genkit/Gemini)', {
    method: 'POST',
    url: `${BASE_URL}/${pipelineId}/evaluar-screening`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter'
    }
  }, 200);

  const dataEval = evalRes.body.data;
  if (
    !Array.isArray(dataEval.resultado_screening) ||
    dataEval.resultado_screening.length !== 2 ||
    typeof dataEval.fit_score_screening !== 'number' ||
    typeof dataEval.tiene_knockout !== 'boolean' ||
    !dataEval.fecha_modificacion_screening
  ) {
    console.error('❌ ERROR: La evaluación de screening con IA no retornó los campos esperados.');
    process.exit(1);
  }
  console.log(`✅ Evaluado con éxito. Fit Score: ${dataEval.fit_score_screening} | Tiene Knockout: ${dataEval.tiene_knockout} | Fecha Modificación: ${dataEval.fecha_modificacion_screening}`);

  console.log('\n========================================');
  console.log('Batería de pruebas de Screening IA completada con ÉXITO total.');
  console.log('========================================');
  process.exit(0);
}

start();
