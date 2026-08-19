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
    let response;
    if (options.isFormData) {
      response = await fetch(options.url || BASE_URL, {
        method: options.method || 'POST',
        headers: options.headers || {},
        body: options.body
      });
    } else {
      response = await fetch(options.url || BASE_URL, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    }

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
  console.log('Iniciando batería de pruebas para Análisis de Transcripción de Entrevistas por IA...');

  // 1. Crear Búsqueda
  console.log('Creando búsqueda REQ-TRANSCRIPCION-TEST...');
  const searchBody = {
    id_busqueda: 'REQ-TRANSCRIPCION-TEST',
    identificacion: {
      cliente: 'Cliente Minero Global',
      hiring_manager: 'Laura Fernández',
      fecha_apertura: '2026-08-19T00:00:00Z'
    },
    perfil_tecnico: {
      rol_solicitado: 'Líder Técnico Backend',
      seniority: 'Senior'
    },
    estado_sla: {
      estado_busqueda: 'Abierta'
    },
    criterios_screening: [
      {
        id: 'crit_101',
        pregunta: '¿Tiene al menos 5 años de experiencia con Node.js y Express?',
        tipo: 'knockout',
        peso: 0
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
    console.error('Error al preparar búsqueda para test de transcripción');
    process.exit(1);
  }
  const searchData = await searchRes.json();
  const realIdBusqueda = searchData.data.id_busqueda;
  console.log(`Búsqueda creada con ID real: ${realIdBusqueda}`);

  // 2. Crear candidato con CV
  console.log('Creando candidato con CV...');
  const candFormData = new FormData();
  const cvBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Size 1 >>\nstartxref\n10\n%%EOF');
  candFormData.append('cv', new Blob([cvBuffer], { type: 'application/pdf' }), 'cv_candidato_trans.pdf');
  candFormData.append('nombre_completo', 'Marcos Giménez');
  candFormData.append('email', 'marcos.gimenez@test.com');
  candFormData.append('acepta_privacidad', 'true');

  const candRes = await fetch(CANDIDATOS_URL, {
    method: 'POST',
    body: candFormData
  });
  const candData = await candRes.json();
  const candId = candData.data.id;
  console.log(`Candidato creado con ID: ${candId}`);

  // 3. Vincular al pipeline
  const pipeRes = await runTestCase('Vincular candidato al pipeline para prueba de transcripción', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: {
      id_busqueda: realIdBusqueda,
      id_candidato: candId
    }
  }, 201);

  const pipelineId = pipeRes.body.data.id;

  // 4. Invocación de análisis de transcripción: POST /api/v1/pipeline/:id/analizar-transcripcion
  console.log('\nAnalizando transcripción con IA en memoria...');
  const transFormData = new FormData();
  const transBuffer = Buffer.from('%PDF-1.4\n% Transcripcion de llamada de screening con Marcos Giménez\nReclutador: ¿Cuál es tu pretensión salarial?\nCandidato: 4500 USD brutos.');
  transFormData.append('transcripcion', new Blob([transBuffer], { type: 'application/pdf' }), 'transcripcion_marcos.pdf');

  const evalRes = await runTestCase('POST /api/v1/pipeline/:id/analizar-transcripcion', {
    method: 'POST',
    url: `${BASE_URL}/${pipelineId}/analizar-transcripcion`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter'
    },
    isFormData: true,
    body: transFormData
  }, 200);

  const informe = evalRes.body.data.f2_evaluacion?.informe_entrevista_ia;
  if (
    !informe ||
    !informe.experiencia_consolidada ||
    !informe.alineacion_motivadores ||
    !informe.pretension_economica_condiciones ||
    !Array.isArray(informe.proximos_pasos) ||
    !informe.auditoria_veracidad ||
    !informe.fecha_analisis
  ) {
    console.error('❌ ERROR: El informe de entrevista por IA (informe_entrevista_ia) no contiene la estructura requerida.');
    process.exit(1);
  }
  console.log(`✅ Informe de entrevista procesado con éxito. Fecha análisis: ${informe.fecha_analisis}`);

  // 5. Probar actualización manual (Human-in-the-loop) vía PATCH /api/v1/pipeline/:id
  const patchRes = await runTestCase('PATCH /api/v1/pipeline/:id - Edición manual de informe_entrevista_ia (Human-in-the-loop)', {
    method: 'PATCH',
    url: `${BASE_URL}/${pipelineId}`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: {
      f2_evaluacion: {
        informe_entrevista_ia: {
          ...informe,
          experiencia_consolidada: 'Experiencia validada y editada manualmente por el reclutador.'
        }
      }
    }
  }, 200);

  if (patchRes.body.data.f2_evaluacion?.informe_entrevista_ia?.experiencia_consolidada !== 'Experiencia validada y editada manualmente por el reclutador.') {
    console.error('❌ ERROR: La actualización manual de informe_entrevista_ia no se persistió correctamente.');
    process.exit(1);
  }
  console.log('✅ Edición Human-in-the-loop guardada correctamente vía PATCH.');

  console.log('\n========================================');
  console.log('Batería de pruebas de Análisis de Transcripción por IA completada con ÉXITO total.');
  console.log('========================================');
  process.exit(0);
}

start();
