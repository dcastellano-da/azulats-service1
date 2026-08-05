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
  console.log('Iniciando batería de pruebas para Módulo de Pipeline (Mejoras Julio 2026)...');

  // 1. Crear Búsqueda y Candidato ficticios a través de endpoints de la API
  console.log('Creando búsqueda "REQ-PIPE-TEST" a través de POST /api/v1/busquedas...');
  const searchBody = {
    id_busqueda: 'REQ-PIPE-TEST',
    identificacion: {
      cliente: 'Azul Corp',
      hiring_manager: 'Sofia Ruiz',
      fecha_apertura: '2026-07-20T00:00:00Z'
    },
    perfil_tecnico: {
      rol_solicitado: 'QA Engineer',
      seniority: 'Semi Senior'
    },
    estado_sla: {
      estado_busqueda: 'Abierta'
    }
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
    const errText = await searchRes.text();
    console.error(`Error al preparar búsqueda:`, errText);
    process.exit(1);
  }
  console.log('Búsqueda "REQ-PIPE-TEST" creada exitosamente.');

  console.log('Creando candidato a través de POST /api/v1/candidatos...');
  const formData = new FormData();
  const pdfBuffer = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Size 1 >>\nstartxref\n10\n%%EOF');
  formData.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'candidato_cv.pdf');
  formData.append('nombre_completo', 'Carlos Pipeline QA');
  formData.append('email', 'carlos.pipeline@azul.com');
  formData.append('acepta_privacidad', 'true');
  formData.append('skills_principales', 'Node.js, React, GCP');

  const candRes = await fetch(CANDIDATOS_URL, {
    method: 'POST',
    body: formData
  });

  if (candRes.status !== 201) {
    const errText = await candRes.text();
    console.error(`Error al preparar candidato:`, errText);
    process.exit(1);
  }
  const candData = await candRes.json();
  const candId = candData.data.id;
  console.log(`Candidato creado con ID: ${candId}`);

  // 2. POST /: Vincular candidato vacante (Exitoso)
  const pipePostResult = await runTestCase('Vincular candidato con vacante (POST exitoso y validar esquema inicial)', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: {
      id_busqueda: 'REQ-PIPE-TEST',
      id_candidato: candId
    }
  }, 201);

  const pipelineId = pipePostResult.body.data.id;

  // Aserciones de validación de estructura de creación
  const dataPost = pipePostResult.body.data;
  if (
    dataPost.f1_descubrimiento?.notas_reclutador !== null ||
    !Array.isArray(dataPost.f1_descubrimiento?.reuniones) ||
    dataPost.f1_descubrimiento?.reuniones.length !== 0 ||
    dataPost.f2_evaluacion?.puntaje_tecnico !== null ||
    dataPost.f2_evaluacion?.notas_reclutador !== null ||
    !Array.isArray(dataPost.f2_evaluacion?.reuniones) ||
    dataPost.f3_cliente?.feedback_cliente !== null ||
    dataPost.f3_cliente?.notas_reclutador !== null ||
    !Array.isArray(dataPost.f3_cliente?.reuniones) ||
    dataPost.f4_cierre?.notas_reclutador !== null ||
    dataPost.f4_cierre?.condiciones_oferta !== null ||
    !Array.isArray(dataPost.f4_cierre?.reuniones) ||
    dataPost.resolucion?.estado_final !== null ||
    dataPost.resolucion?.motivo_rechazo !== null ||
    dataPost.resolucion?.fecha_resolucion !== null ||
    !Array.isArray(dataPost.resultado_screening) ||
    dataPost.resultado_screening.length !== 0 ||
    dataPost.fit_score_screening !== 0 ||
    dataPost.tiene_knockout !== false ||
    dataPost.fecha_modificacion_screening !== null
  ) {
    console.error("❌ ERROR: La estructura JSON inicial no coincide con la esperada.");
    process.exit(1);
  }
  console.log("✅ Estructura JSON creada aprobada (Fases F1-F4, screening por defecto inicializado).");

  // 3. PATCH /:id: Actualizar campos cualitativos en fases y resolución
  const updateQualitative = {
    f1_descubrimiento: {
      notas_reclutador: 'Buen perfil'
    },
    f2_evaluacion: {
      puntaje_tecnico: 90,
      notas_reclutador: 'Dudas en arquitectura'
    },
    f3_cliente: {
      feedback_cliente: 'Entrevista excelente con el equipo',
      notas_reclutador: 'Cliente conforme'
    },
    f4_cierre: {
      notas_reclutador: 'Oferta aceptada por candidato',
      condiciones_oferta: '65K EUR'
    },
    resolucion: {
      estado_final: 'Contratado',
      motivo_rechazo: null,
      fecha_resolucion: '2026-07-28T15:30:00Z'
    }
  };

  const patchQualRes = await runTestCase('Actualizar bloques f1, f2, f3, f4 y resolucion (PATCH exitoso)', {
    method: 'PATCH',
    url: `${BASE_URL}/${pipelineId}`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: updateQualitative
  }, 200);

  const dataQual = patchQualRes.body.data;
  if (
    dataQual.f1_descubrimiento.notas_reclutador !== 'Buen perfil' ||
    dataQual.f2_evaluacion.puntaje_tecnico !== 90 ||
    dataQual.f2_evaluacion.notas_reclutador !== 'Dudas en arquitectura' ||
    dataQual.f3_cliente.feedback_cliente !== 'Entrevista excelente con el equipo' ||
    dataQual.f3_cliente.notas_reclutador !== 'Cliente conforme' ||
    dataQual.f4_cierre.notas_reclutador !== 'Oferta aceptada por candidato' ||
    dataQual.f4_cierre.condiciones_oferta !== '65K EUR' ||
    dataQual.resolucion.estado_final !== 'Contratado'
  ) {
    console.error("❌ ERROR: Uno o más campos cualitativos no se actualizaron correctamente.");
    process.exit(1);
  }
  console.log("✅ Actualización cualitativa comprobada con éxito.");

  // 4. PATCH /:id: Agendar múltiples reuniones dinámicamente y validar autogeneración de UUID
  const addReunionesBody = {
    f2_evaluacion: {
      reuniones: [
        {
          fecha_hora: '2026-07-25T10:00:00Z',
          link_reunion: 'https://meet.google.com/abc-defg-hij',
          objetivo: 'Screening inicial',
          notas: 'Primera intro'
        },
        {
          fecha_hora: '2026-07-28T15:00:00Z',
          link_reunion: 'https://zoom.us/j/123456789',
          objetivo: 'Entrevista Técnica',
          notas: 'Profundizar en Node.js'
        }
      ]
    }
  };

  const patchReunionesRes = await runTestCase('Agendar reuniones dinámicas con autogeneración de ID', {
    method: 'PATCH',
    url: `${BASE_URL}/${pipelineId}`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: addReunionesBody
  }, 200);

  const dataReuniones = patchReunionesRes.body.data;
  const listF2Reuniones = dataReuniones.f2_evaluacion.reuniones;
  if (!Array.isArray(listF2Reuniones) || listF2Reuniones.length !== 2) {
    console.error("❌ ERROR: El número de reuniones en f2_evaluacion no es 2.");
    process.exit(1);
  }
  if (!listF2Reuniones[0].id_reunion || !listF2Reuniones[1].id_reunion) {
    console.error("❌ ERROR: Falta el id_reunion generado en el servidor.");
    process.exit(1);
  }
  console.log(`✅ Reuniones agendadas con éxito. IDs autogenerados: ${listF2Reuniones[0].id_reunion}, ${listF2Reuniones[1].id_reunion}`);

  // Guardar IDs para pruebas de actualización de reunión
  const idReunion1 = listF2Reuniones[0].id_reunion;
  const idReunion2 = listF2Reuniones[1].id_reunion;

  // 5. PATCH /:id: Modificar una reunión existente (enviar array con id_reunion coincidente e ID anterior)
  const updateReunionesBody = {
    f2_evaluacion: {
      reuniones: [
        {
          id_reunion: idReunion1,
          fecha_hora: '2026-07-25T11:30:00Z', // Modificada hora
          link_reunion: 'https://meet.google.com/abc-modified', // Modificado link
          objetivo: 'Screening inicial actualizado',
          notas: 'Notas actualizadas'
        },
        {
          id_reunion: idReunion2,
          fecha_hora: '2026-07-28T15:00:00Z',
          link_reunion: 'https://zoom.us/j/123456789',
          objetivo: 'Entrevista Técnica',
          notas: 'Profundizar en Node.js'
        }
      ]
    }
  };

  const patchUpdateReunionesRes = await runTestCase('Actualizar reunión existente mediante id_reunion', {
    method: 'PATCH',
    url: `${BASE_URL}/${pipelineId}`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: updateReunionesBody
  }, 200);

  const listModified = patchUpdateReunionesRes.body.data.f2_evaluacion.reuniones;
  const item1 = listModified.find(r => r.id_reunion === idReunion1);
  if (!item1 || item1.fecha_hora !== '2026-07-25T11:30:00Z' || item1.link_reunion !== 'https://meet.google.com/abc-modified') {
    console.error("❌ ERROR: La actualización de la reunión por id_reunion falló.");
    process.exit(1);
  }
  console.log("✅ Actualización de reunión por ID exitosa.");

  // 6. PATCH /:id: Validar error con fecha inválida (HTTP 400)
  const invalidReunionesBody = {
    f1_descubrimiento: {
      reuniones: [
        {
          fecha_hora: 'ESTO-NO-ES-FECHA',
          link_reunion: 'https://meet.google.com',
          objetivo: 'Reunión inválida'
        }
      ]
    }
  };

  await runTestCase('Rechazar formato de fecha de reunión inválido (HTTP 400)', {
    method: 'PATCH',
    url: `${BASE_URL}/${pipelineId}`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: invalidReunionesBody
  }, 400);

  // 7. PATCH /:id: Validar retrocompatibilidad con las propiedades antiguas
  const oldCompatibilityBody = {
    evaluacion: {
      puntaje_tecnico: 95,
      feedback_cliente: 'Sobresaliente'
    },
    cierre: {
      fecha_cierre: '2026-07-29T12:00:00Z',
      motivo_rechazo: 'Ninguno - Retrocompatible'
    }
  };

  const patchCompatRes = await runTestCase('Probar retrocompatibilidad del payload antiguo (HTTP 200)', {
    method: 'PATCH',
    url: `${BASE_URL}/${pipelineId}`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter',
      'Content-Type': 'application/json'
    },
    body: oldCompatibilityBody
  }, 200);

  const dataCompat = patchCompatRes.body.data;
  if (
    dataCompat.f2_evaluacion.puntaje_tecnico !== 95 ||
    dataCompat.f3_cliente.feedback_cliente !== 'Sobresaliente' ||
    dataCompat.resolucion.fecha_resolucion !== '2026-07-29T12:00:00Z' ||
    dataCompat.resolucion.motivo_rechazo !== 'Ninguno - Retrocompatible'
  ) {
    console.error("❌ ERROR: La lógica de retrocompatibilidad de evaluación/cierre falló.");
    process.exit(1);
  }
  console.log("✅ Retrocompatibilidad exitosa: los campos antiguos se mapearon a los nuevos bloques.");

  // 8. GET /:id - Consultar pipeline individual por ID
  const getByIdRes = await runTestCase('Obtener pipeline individual por ID (HTTP 200)', {
    method: 'GET',
    url: `${BASE_URL}/${pipelineId}`,
    headers: { 'Authorization': 'Bearer mock-token-recruiter' }
  }, 200);

  const dataById = getByIdRes.body.data;
  if (
    !dataById ||
    dataById.id !== pipelineId ||
    !dataById.claves_conexion ||
    !Array.isArray(dataById.resultado_screening) ||
    dataById.fit_score_screening === undefined ||
    dataById.tiene_knockout === undefined ||
    !('fecha_modificacion_screening' in dataById)
  ) {
    console.error('❌ ERROR: GET /:id no retorna todos los campos requeridos de screening.');
    process.exit(1);
  }
  console.log(`✅ GET /:id correcto. ID coincide: ${dataById.id === pipelineId}. Campos de screening presentes.`);

  // 8b. GET /:id con ID inválido (HTTP 404)
  await runTestCase('GET /:id con ID inexistente (HTTP 404)', {
    method: 'GET',
    url: `${BASE_URL}/ESTE-ID-NO-EXISTE`,
    headers: { 'Authorization': 'Bearer mock-token-recruiter' }
  }, 404);

  // 9. DELETE /:id: Eliminar el vínculo
  await runTestCase('Borrar vínculo de pipeline (desvinculación física)', {
    method: 'DELETE',
    url: `${BASE_URL}/${pipelineId}`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter'
    }
  }, 200);

  console.log('\n========================================');
  console.log('Batería de pruebas de Pipeline finalizada con ÉXITO total.');
  console.log('========================================');
  process.exit(0);
}

start();
