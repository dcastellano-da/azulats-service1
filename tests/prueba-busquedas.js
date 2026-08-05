import fs from 'fs';

const PORT = process.env.PORT || 8080;
const BASE_URL = `http://127.0.0.1:${PORT}/api/v1/busquedas`;

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
  console.log('Iniciando batería de pruebas para Módulo de Búsquedas (Etapa 1)...');

  // 1. Crear búsqueda exitosa
  const busquedaExitosa = {
    id_busqueda: 'REQ-MOCK-001',
    identificacion: {
      cliente: 'Banco de Barcelona',
      hiring_manager: 'Andrés Iniesta',
      fecha_apertura: '2026-07-20T00:00:00Z'
    },
    perfil_tecnico: {
      rol_solicitado: 'Node.js Developer Senior',
      seniority: 'Senior',
      skills_excluyentes: ['Node.js', 'Firestore', 'Docker'],
      skills_deseables: ['GCP', 'TypeScript'],
      nivel_ingles_req: 'B2 Conversacional'
    },
    condiciones: {
      modalidad: 'Remoto',
      zona_horaria_ubicacion: 'Madrid (CET)'
    },
    estado_sla: {
      presupuesto_max: '60K EUR',
      estado_busqueda: 'Abierta',
      prioridad: 'Alta',
      link_job_description: 'https://docs.google.com/test-jd'
    },
    criterios_screening: [
      {
        pregunta: '¿Tiene al menos 5 años de experiencia en logística?',
        tipo: 'knockout',
        peso: 0
      },
      {
        pregunta: '¿Tiene experiencia en Minería?',
        tipo: 'deseable',
        peso: 30
      }
    ]
  };

  const postResult = await runTestCase('Registro de Búsqueda Exitoso (con Criterios de Screening)', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: busquedaExitosa
  }, 201);

  if (
    !Array.isArray(postResult.body.data.criterios_screening) ||
    postResult.body.data.criterios_screening.length !== 2 ||
    !postResult.body.data.criterios_screening[0].id ||
    !postResult.body.data.criterios_screening[1].id
  ) {
    console.error('❌ ERROR: Los criterios_screening no se crearon adecuadamente con UUIDs inmutables.');
    process.exit(1);
  }
  console.log('✅ Aprobado: criterios_screening guardados con UUIDs inmutables:', postResult.body.data.criterios_screening);

  // 2. Falla registrar búsqueda con campos requeridos ausentes
  const busquedaInvalida = {
    identificacion: {
      cliente: '' // vacío
    },
    perfil_tecnico: {
      rol_solicitado: 'Only java'
    }
  };

  await runTestCase('Falla al enviar campos obligatorios incompletos (cliente vacío)', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: busquedaInvalida
  }, 400);

  // 3. GET / sin token -> Espera 401
  await runTestCase('GET / (Read) sin token de sesión', {
    method: 'GET',
    url: BASE_URL
  }, 401);

  // 4. GET / con token inválido -> Espera 403
  await runTestCase('GET / (Read) con token inválido', {
    method: 'GET',
    url: BASE_URL,
    headers: {
      'Authorization': 'Bearer token-invalido-expirado'
    }
  }, 403);

  // 5. GET / con token de reclutador simulado -> Espera 200
  await runTestCase('GET / (Read) exitoso con token reclutador', {
    method: 'GET',
    url: BASE_URL,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter'
    }
  }, 200);

  // 6. PATCH /:id exitoso (mutar estado_busqueda y prioridad)
  await runTestCase('PATCH /:id (Update) exitoso de campos permitidos (estado_busqueda y prioridad)', {
    method: 'PATCH',
    url: `${BASE_URL}/REQ-MOCK-001`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: {
      estado_busqueda: 'Pausada',
      prioridad: 'Crítica'
    }
  }, 200);

  // 7. PATCH /:id exitoso (mutar criterios_screening sobre la marcha)
  const patchCriteriosRes = await runTestCase('PATCH /:id (Update) exitoso de criterios_screening sobre la marcha', {
    method: 'PATCH',
    url: `${BASE_URL}/REQ-MOCK-001`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: {
      criterios_screening: [
        {
          pregunta: '¿Tiene título universitario de Grado?',
          tipo: 'knockout',
          peso: 0
        }
      ]
    }
  }, 200);

  if (!patchCriteriosRes.body.data.criterios_screening[0].id) {
    console.error('❌ ERROR: El nuevo criterio_screening no generó UUID al actualizar.');
    process.exit(1);
  }
  console.log('✅ Aprobado: Actualización dinámica de criterios_screening verificada.');

  // 8. PATCH /:id exitoso usando sub-bloques anidados y nuevos campos descriptivos
  await runTestCase('PATCH /:id (Update) exitoso de nuevos campos descriptivos anidados', {
    method: 'PATCH',
    url: `${BASE_URL}/REQ-MOCK-001`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: {
      identificacion: {
        hiring_manager: 'Xavi Hernandez'
      },
      perfil_tecnico: {
        skills_excluyentes: ['Node.js', 'PostgreSQL'],
        skills_deseables: ['Redis', 'Docker'],
        nivel_ingles_req: 'C1 Avanzado'
      },
      condiciones: {
        modalidad: 'Híbrido'
      },
      estado_sla: {
        presupuesto_max: '75K EUR',
        estado_busqueda: 'Abierta',
        prioridad: 'Baja',
        link_job_description: 'https://docs.google.com/updated-jd'
      }
    }
  }, 200);

  // 8b. PATCH /:id exitoso enviando criterios_screening dentro de estado_sla o camelCase criteriosScreening
  const patchNestedCriterios = await runTestCase('PATCH /:id (Update) exitoso enviando criterios_screening dentro de estado_sla', {
    method: 'PATCH',
    url: `${BASE_URL}/REQ-MOCK-001`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: {
      estado_sla: {
        estado_busqueda: 'Abierta',
        criterios_screening: [
          {
            pregunta: '¿Tiene experiencia en Kubernetes?',
            tipo: 'deseable',
            peso: 15
          }
        ]
      }
    }
  }, 200);

  if (!patchNestedCriterios.body.data.criterios_screening) {
    console.error('❌ ERROR: criterios_screening no fue devuelto dentro de data.');
    process.exit(1);
  }
  console.log('✅ Aprobado: criterios_screening anidado en estado_sla actualizado correctamente.');

  // 9. PATCH /:id ignora campos no reconocidos (Zod .strip()) al enviar propiedades no definidas junto a campos válidos
  await runTestCase('PATCH /:id (Update) ignora propiedades no reconocidas (.strip()) y actualiza campos permitidos', {
    method: 'PATCH',
    url: `${BASE_URL}/REQ-MOCK-001`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: {
      cliente: 'Intento cambiar cliente no permitido',
      campo_inexistente_123: 'Valor descartado',
      identificacion: {
        hiring_manager: 'Lionel Messi'
      }
    }
  }, 200);

  // 10. PATCH /:id devuelve HTTP 400 si solo se envían campos no permitidos/reconocidos (sin nada que actualizar)
  await runTestCase('PATCH /:id (Update) devuelve 400 si no se incluye ningún campo válido tras .strip()', {
    method: 'PATCH',
    url: `${BASE_URL}/REQ-MOCK-001`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: {
      cliente: 'Solo campo inmutable'
    }
  }, 400);

  console.log('\n========================================');
  console.log('Batería de pruebas de Búsquedas finalizada.');
  console.log('========================================');
}

start();
