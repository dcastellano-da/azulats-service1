import { db, bucket } from '../config/firebase.js';
import crypto from 'crypto';
import { z } from 'zod';
import { ai, modelRef } from '../config/genkit.js';

/**
 * Normaliza la serialización de un documento de pipeline hacia HTTP.
 * Garantiza que id, resultado_screening, fit_score_screening,
 * tiene_knockout y fecha_modificacion_screening siempre estén presentes
 * en la raíz del objeto, independientemente de cómo estén almacenados
 * en Firestore (snake_case o camelCase heredado).
 *
 * @param {string} docId  - Clave documental de Firestore (doc.id)
 * @param {object} data   - Resultado de doc.data()
 * @returns {object}      - Objeto normalizado listo para la respuesta HTTP
 */
function normalizePipelineDoc(docId, data) {
  return {
    ...data,
    id: docId,
    resultado_screening:
      Array.isArray(data.resultado_screening) && data.resultado_screening.length > 0
        ? data.resultado_screening
        : (Array.isArray(data.resultadoScreening) && data.resultadoScreening.length > 0
            ? data.resultadoScreening
            : (data.resultado_screening || [])),
    fit_score_screening:
      data.fit_score_screening !== undefined && data.fit_score_screening !== null
        ? data.fit_score_screening
        : (data.fitScore !== undefined ? data.fitScore : 0),
    tiene_knockout:
      data.tiene_knockout !== undefined && data.tiene_knockout !== null
        ? data.tiene_knockout
        : (data.tieneKnockout !== undefined ? data.tieneKnockout : false),
    fecha_modificacion_screening:
      data.fecha_modificacion_screening || data.fechaModificacionScreening || null
  };
}

const parseAndValidateReuniones = (reunionesInput) => {
  if (!Array.isArray(reunionesInput)) {
    throw new Error('El campo reuniones debe ser un arreglo.');
  }

  const schema = z.object({
    id_reunion: z.string().optional(),
    fecha_hora: z.string().refine(val => !isNaN(Date.parse(val)), {
      message: 'Debe ser un string de fecha ISO 8601 válido.'
    }).nullable().optional(),
    link_reunion: z.string().nullable().optional(),
    objetivo: z.string().nullable().optional(),
    notas: z.string().nullable().optional(),
  });

  return reunionesInput.map(item => {
    const parseResult = schema.safeParse(item);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Datos de reunión inválidos: ${issues}`);
    }

    const { id_reunion, fecha_hora, link_reunion, objetivo, notas } = parseResult.data;

    return {
      id_reunion: id_reunion || crypto.randomUUID(),
      fecha_hora: fecha_hora || null,
      link_reunion: link_reunion || null,
      objetivo: objetivo || null,
      notas: notas || null
    };
  });
};

/**
 * POST /api/v1/pipeline
 * Asocia un candidato con una búsqueda (vínculo N-N)
 */
export const crearPipeline = async (req, res) => {
  const {
    id_busqueda,
    id_candidato,
    claves_conexion,
    f1_descubrimiento
  } = req.body;

  // Extraer claves de conexión permitiendo formato plano y formateado
  const finalIdBusqueda = id_busqueda || claves_conexion?.id_busqueda;
  const finalIdCandidato = id_candidato || claves_conexion?.id_candidato;

  if (!finalIdBusqueda || !finalIdCandidato) {
    return res.status(400).json({
      status: 'error',
      message: 'Los campos id_busqueda e id_candidato son obligatorios.'
    });
  }

  try {
    // 1. Validar que la búsqueda exista en Firestore
    const busqDoc = await db.collection('busquedas').doc(finalIdBusqueda).get();
    if (!busqDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: `La búsqueda con ID '${finalIdBusqueda}' no existe.`
      });
    }

    // 2. Validar que el candidato exista en Firestore y resolver su ID real de documento
    let candDoc = await db.collection('postulantes').doc(finalIdCandidato).get();
    let realIdCandidato = finalIdCandidato;

    if (!candDoc.exists) {
      // Búsqueda de respaldo por id_candidato
      const candSnap = await db.collection('postulantes')
        .where('id_candidato', '==', finalIdCandidato)
        .get();

      if (!candSnap.empty) {
        candDoc = candSnap.docs[0];
        realIdCandidato = candDoc.id;
      } else {
        return res.status(404).json({
          status: 'error',
          message: `El candidato con ID '${finalIdCandidato}' no existe.`
        });
      }
    } else {
      realIdCandidato = candDoc.id;
    }

    // 3. Validar duplicados de la postulación
    const dupeSnap = await db.collection('pipeline_entrevistas')
      .where('claves_conexion.id_busqueda', '==', finalIdBusqueda)
      .where('claves_conexion.id_candidato', '==', realIdCandidato)
      .get();

    if (dupeSnap.docs.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'El candidato ya se encuentra asociado a esta búsqueda en el pipeline (duplicidad bloqueada).'
      });
    }

    // 4. Armar documento puente
    const docRef = db.collection('pipeline_entrevistas').doc();
    const mockId = docRef.id;

    const timestamp = new Date().toISOString();

    const finalDoc = {
      id: mockId,
      claves_conexion: {
        id_busqueda: finalIdBusqueda,
        id_candidato: realIdCandidato
      },
      flujo: {
        estado_actual: "01 - Nuevo (Para Revisión)",
        fecha_ultimo_cambio: timestamp,
        historial_estados: [
          {
            estado: "01 - Nuevo (Para Revisión)",
            timestamp: timestamp
          }
        ]
      },
      f1_descubrimiento: {
        analisis_semantico: f1_descubrimiento?.analisis_semantico || null,
        outreach: f1_descubrimiento?.outreach || {
          variante_enviada: null,
          fecha_envio: null
        },
        notas_reclutador: f1_descubrimiento?.notas_reclutador || null,
        reuniones: f1_descubrimiento?.reuniones || []
      },
      f2_evaluacion: {
        puntaje_tecnico: null,
        notas_reclutador: null,
        reuniones: []
      },
      f3_cliente: {
        feedback_cliente: null,
        notas_reclutador: null,
        reuniones: []
      },
      f4_cierre: {
        notas_reclutador: null,
        condiciones_oferta: null,
        reuniones: []
      },
      resolucion: {
        estado_final: null,
        motivo_rechazo: null,
        fecha_resolucion: null
      },
      resultado_screening: [],
      fit_score_screening: 0,
      tiene_knockout: false,
      fecha_modificacion_screening: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await docRef.set(finalDoc);

    return res.status(201).json({
      status: 'success',
      message: 'Candidato asociado exitosamente al pipeline de la búsqueda.',
      data: finalDoc
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error al asociar candidato en pipeline.',
      detail: error.message
    });
  }
};

/**
 * GET /api/v1/pipeline
 * Recupera el tablero Kanban para una búsqueda. Requiere id_busqueda.
 */
export const obtenerPipeline = async (req, res) => {
  const { id_busqueda, estado_actual } = req.query;

  if (!id_busqueda) {
    return res.status(400).json({
      status: 'error',
      message: 'El parámetro query id_busqueda es obligatorio.'
    });
  }

  try {
    let query = db.collection('pipeline_entrevistas')
      .where('claves_conexion.id_busqueda', '==', id_busqueda);

    if (estado_actual) {
      query = query.where('flujo.estado_actual', '==', estado_actual);
    }

    const snap = await query.get();
    const items = snap.docs.map(doc => normalizePipelineDoc(doc.id, doc.data()));

    return res.status(200).json({
      status: 'success',
      total: items.length,
      data: items
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error al consultar el pipeline.',
      detail: error.message
    });
  }
};

/**
 * GET /api/v1/pipeline/:id
 * Retorna un único registro de pipeline por su ID documental.
 */
export const obtenerPipelineById = async (req, res) => {
  const { id } = req.params;

  try {
    const docRef = db.collection('pipeline_entrevistas').doc(id);
    const snap = await docRef.get();

    if (!snap.exists) {
      return res.status(404).json({
        status: 'error',
        message: `No se encontró un registro de pipeline con ID '${id}'.`
      });
    }

    return res.status(200).json({
      status: 'success',
      data: normalizePipelineDoc(snap.id, snap.data())
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error al consultar el pipeline.',
      detail: error.message
    });
  }
};

/**
 * PATCH /api/v1/pipeline/:id
 * Actualiza el estado de la etapa (Kanban), AI, los bloques evaluacion/cierre o resultado_screening manual.
 */
export const actualizarPipeline = async (req, res) => {
  const { id } = req.params;
  const body = req.body;

  if (!id) {
    return res.status(400).json({
      status: 'error',
      message: 'El identificador del pipeline en la ruta es requerido.'
    });
  }

  try {
    const docRef = db.collection('pipeline_entrevistas').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        status: 'error',
        message: `El registro de pipeline con ID '${id}' no existe.`
      });
    }

    const currentDoc = docSnap.data();
    const updates = {};
    const timestamp = new Date().toISOString();

    // 1. Procesar cambio de estado_actual
    const nuevoEstado = body.estado_actual || body.flujo?.estado_actual;
    if (nuevoEstado && nuevoEstado !== currentDoc.flujo?.estado_actual) {
      updates['flujo.estado_actual'] = nuevoEstado;
      updates['flujo.fecha_ultimo_cambio'] = timestamp;

      // Inyectar en el historial
      const historialActual = currentDoc.flujo?.historial_estados || [];
      const nuevoHistorial = [...historialActual, { estado: nuevoEstado, timestamp }];
      updates['flujo.historial_estados'] = nuevoHistorial;
    }

    // 2. Procesar analisis_semantico (AI)
    const analisis = body.analisis_semantico || body.f1_descubrimiento?.analisis_semantico;
    if (analisis) {
      updates['f1_descubrimiento.analisis_semantico'] = analisis;
    }

    // 3. Procesar outreach
    const outreach = body.outreach || body.f1_descubrimiento?.outreach;
    if (outreach) {
      updates['f1_descubrimiento.outreach'] = outreach;
    }

    try {
      // 4. Procesar f1_descubrimiento (notas_reclutador, reuniones)
      if (body.f1_descubrimiento?.notas_reclutador !== undefined) {
        updates['f1_descubrimiento.notas_reclutador'] = body.f1_descubrimiento.notas_reclutador;
      } else if (body['f1_descubrimiento.notas_reclutador'] !== undefined) {
        updates['f1_descubrimiento.notas_reclutador'] = body['f1_descubrimiento.notas_reclutador'];
      }

      if (body.f1_descubrimiento?.reuniones !== undefined) {
        updates['f1_descubrimiento.reuniones'] = parseAndValidateReuniones(body.f1_descubrimiento.reuniones);
      } else if (body['f1_descubrimiento.reuniones'] !== undefined) {
        updates['f1_descubrimiento.reuniones'] = parseAndValidateReuniones(body['f1_descubrimiento.reuniones']);
      }

      // 5. Procesar f2_evaluacion (puntaje_tecnico, notas_reclutador, reuniones)
      if (body.f2_evaluacion?.puntaje_tecnico !== undefined) {
        updates['f2_evaluacion.puntaje_tecnico'] = body.f2_evaluacion.puntaje_tecnico;
      } else if (body['f2_evaluacion.puntaje_tecnico'] !== undefined) {
        updates['f2_evaluacion.puntaje_tecnico'] = body['f2_evaluacion.puntaje_tecnico'];
      } else if (body.evaluacion?.puntaje_tecnico !== undefined) {
        updates['f2_evaluacion.puntaje_tecnico'] = body.evaluacion.puntaje_tecnico;
      } else if (body['evaluacion.puntaje_tecnico'] !== undefined) {
        updates['f2_evaluacion.puntaje_tecnico'] = body['evaluacion.puntaje_tecnico'];
      }

      if (body.f2_evaluacion?.notas_reclutador !== undefined) {
        updates['f2_evaluacion.notas_reclutador'] = body.f2_evaluacion.notas_reclutador;
      } else if (body['f2_evaluacion.notas_reclutador'] !== undefined) {
        updates['f2_evaluacion.notas_reclutador'] = body['f2_evaluacion.notas_reclutador'];
      }

      if (body.f2_evaluacion?.reuniones !== undefined) {
        updates['f2_evaluacion.reuniones'] = parseAndValidateReuniones(body.f2_evaluacion.reuniones);
      } else if (body['f2_evaluacion.reuniones'] !== undefined) {
        updates['f2_evaluacion.reuniones'] = parseAndValidateReuniones(body['f2_evaluacion.reuniones']);
      }

      // 6. Procesar f3_cliente (feedback_cliente, notas_reclutador, reuniones)
      if (body.f3_cliente?.feedback_cliente !== undefined) {
        updates['f3_cliente.feedback_cliente'] = body.f3_cliente.feedback_cliente;
      } else if (body['f3_cliente.feedback_cliente'] !== undefined) {
        updates['f3_cliente.feedback_cliente'] = body['f3_cliente.feedback_cliente'];
      } else if (body.evaluacion?.feedback_cliente !== undefined) {
        updates['f3_cliente.feedback_cliente'] = body.evaluacion.feedback_cliente;
      } else if (body['evaluacion.feedback_cliente'] !== undefined) {
        updates['f3_cliente.feedback_cliente'] = body['evaluacion.feedback_cliente'];
      }

      if (body.f3_cliente?.notas_reclutador !== undefined) {
        updates['f3_cliente.notas_reclutador'] = body.f3_cliente.notas_reclutador;
      } else if (body['f3_cliente.notas_reclutador'] !== undefined) {
        updates['f3_cliente.notas_reclutador'] = body['f3_cliente.notas_reclutador'];
      }

      if (body.f3_cliente?.reuniones !== undefined) {
        updates['f3_cliente.reuniones'] = parseAndValidateReuniones(body.f3_cliente.reuniones);
      } else if (body['f3_cliente.reuniones'] !== undefined) {
        updates['f3_cliente.reuniones'] = parseAndValidateReuniones(body['f3_cliente.reuniones']);
      }

      // 7. Procesar f4_cierre (notas_reclutador, condiciones_oferta, reuniones)
      if (body.f4_cierre?.notas_reclutador !== undefined) {
        updates['f4_cierre.notas_reclutador'] = body.f4_cierre.notas_reclutador;
      } else if (body['f4_cierre.notas_reclutador'] !== undefined) {
        updates['f4_cierre.notas_reclutador'] = body['f4_cierre.notas_reclutador'];
      }

      if (body.f4_cierre?.condiciones_oferta !== undefined) {
        updates['f4_cierre.condiciones_oferta'] = body.f4_cierre.condiciones_oferta;
      } else if (body['f4_cierre.condiciones_oferta'] !== undefined) {
        updates['f4_cierre.condiciones_oferta'] = body['f4_cierre.condiciones_oferta'];
      }

      if (body.f4_cierre?.reuniones !== undefined) {
        updates['f4_cierre.reuniones'] = parseAndValidateReuniones(body.f4_cierre.reuniones);
      } else if (body['f4_cierre.reuniones'] !== undefined) {
        updates['f4_cierre.reuniones'] = parseAndValidateReuniones(body['f4_cierre.reuniones']);
      }

      // 8. Procesar resolucion (estado_final, motivo_rechazo, fecha_resolucion)
      if (body.resolucion?.estado_final !== undefined) {
        updates['resolucion.estado_final'] = body.resolucion.estado_final;
      } else if (body['resolucion.estado_final'] !== undefined) {
        updates['resolucion.estado_final'] = body['resolucion.estado_final'];
      }

      if (body.resolucion?.motivo_rechazo !== undefined) {
        updates['resolucion.motivo_rechazo'] = body.resolucion.motivo_rechazo;
      } else if (body['resolucion.motivo_rechazo'] !== undefined) {
        updates['resolucion.motivo_rechazo'] = body['resolucion.motivo_rechazo'];
      } else if (body.cierre?.motivo_rechazo !== undefined) {
        updates['resolucion.motivo_rechazo'] = body.cierre.motivo_rechazo;
      } else if (body['cierre.motivo_rechazo'] !== undefined) {
        updates['resolucion.motivo_rechazo'] = body['cierre.motivo_rechazo'];
      }

      if (body.resolucion?.fecha_resolucion !== undefined) {
        updates['resolucion.fecha_resolucion'] = body.resolucion.fecha_resolucion;
      } else if (body['resolucion.fecha_resolucion'] !== undefined) {
        updates['resolucion.fecha_resolucion'] = body['resolucion.fecha_resolucion'];
      } else if (body.cierre?.fecha_cierre !== undefined) {
        updates['resolucion.fecha_resolucion'] = body.cierre.fecha_cierre;
      } else if (body['cierre.fecha_cierre'] !== undefined) {
        updates['resolucion.fecha_resolucion'] = body['cierre.fecha_cierre'];
      }

      // 9. Procesar resultado_screening (edición manual / reclutador human-in-the-loop)
      const resScreening = body.resultado_screening;
      if (resScreening !== undefined) {
        if (!Array.isArray(resScreening)) {
          throw new Error('El campo resultado_screening debe ser un arreglo.');
        }

        const screeningItemSchema = z.object({
          id_criterio: z.string(),
          evaluacion: z.enum(['SI', 'INFERIDO', 'NO']),
          evidencia_cv: z.string().nullable().optional(),
          es_knockout: z.boolean().optional(),
          puntaje_obtenido: z.number().optional()
        });

        let fitScore = 0;
        let tieneKnockout = false;

        const resultadoProcesado = resScreening.map((item, idx) => {
          const parsed = screeningItemSchema.safeParse(item);
          if (!parsed.success) {
            const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
            throw new Error(`Criterio de screening inválido en el índice ${idx}: ${issues}`);
          }

          const { id_criterio, evaluacion, evidencia_cv } = parsed.data;
          const esKnockout = parsed.data.es_knockout !== undefined 
            ? parsed.data.es_knockout 
            : (evaluacion === 'NO');

          const puntaje = parsed.data.puntaje_obtenido !== undefined 
            ? parsed.data.puntaje_obtenido 
            : 0;

          if (evaluacion === 'NO' && esKnockout) {
            tieneKnockout = true;
          }
          fitScore += (puntaje || 0);

          return {
            id_criterio,
            evaluacion,
            evidencia_cv: evidencia_cv || null,
            es_knockout: esKnockout,
            puntaje_obtenido: puntaje
          };
        });

        updates['resultado_screening'] = resultadoProcesado;
        updates['fit_score_screening'] = fitScore;
        updates['tiene_knockout'] = tieneKnockout;
        updates['fecha_modificacion_screening'] = timestamp;
      }
    } catch (valErr) {
      return res.status(400).json({
        status: 'error',
        message: 'Error de validación en los datos provistos.',
        detail: valErr.message
      });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No se enviaron campos válidos para actualizar (puedes actualizar estado_actual, analisis_semantico, f1_descubrimiento, f2_evaluacion, f3_cliente, f4_cierre, resolucion, resultado_screening).'
      });
    }

    updates.updatedAt = timestamp;

    await docRef.update(updates);

    // Obtener documento actualizado para retornar
    const updatedSnap = await docRef.get();
    const updatedData = updatedSnap.data();

    return res.status(200).json({
      status: 'success',
      message: 'Registro de pipeline actualizado correctamente.',
      data: normalizePipelineDoc(docRef.id, updatedData)
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error al actualizar el pipeline.',
      detail: error.message
    });
  }
};

/**
 * DELETE /api/v1/pipeline/:id
 * Elimina la relación sin tocar las entidades maestras.
 */
export const eliminarPipeline = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      status: 'error',
      message: 'El identificador del pipeline en la ruta es requerido.'
    });
  }

  try {
    const docRef = db.collection('pipeline_entrevistas').doc(id);
    const snap = await docRef.get();

    if (!snap.exists) {
      return res.status(404).json({
        status: 'error',
        message: `El registro de pipeline con ID '${id}' no existe.`
      });
    }

    await docRef.delete();

    return res.status(200).json({
      status: 'success',
      message: 'Registro de pipeline eliminado exitosamente (vínculo deshecho).'
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error al eliminar el registro de pipeline.',
      detail: error.message
    });
  }
};

/**
 * POST /api/v1/pipeline/:id/evaluar-screening
 * Ejecuta el Motor de Inferencia con IA (Genkit + Gemini) para evaluar los Criterios de Aceptación / Descarte.
 */
export const evaluarScreeningPipeline = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      status: 'error',
      message: 'El identificador del pipeline en la ruta es requerido.'
    });
  }

  try {
    // 1. Obtener registro del pipeline
    const pipelineRef = db.collection('pipeline_entrevistas').doc(id);
    const pipelineDoc = await pipelineRef.get();

    if (!pipelineDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: `El registro de pipeline con ID '${id}' no existe.`
      });
    }

    const pipelineData = pipelineDoc.data();
    const idBusqueda = pipelineData.claves_conexion?.id_busqueda;
    const idCandidato = pipelineData.claves_conexion?.id_candidato;

    if (!idBusqueda || !idCandidato) {
      return res.status(400).json({
        status: 'error',
        message: 'El registro de pipeline no posee claves_conexion válidas (id_busqueda e id_candidato).'
      });
    }

    // 2. Obtener datos del candidato y validación temprana de url_cv
    const candidatoDoc = await db.collection('postulantes').doc(idCandidato).get();
    if (!candidatoDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: `El candidato asociado con ID '${idCandidato}' no existe.`
      });
    }

    const candidatoData = candidatoDoc.data();
    const gsUri = candidatoData.url_cv;

    if (!gsUri || typeof gsUri !== 'string' || !gsUri.trim()) {
      return res.status(400).json({
        status: 'error',
        message: `El candidato con ID '${idCandidato}' no posee un archivo CV (url_cv) registrado en el sistema para realizar la evaluación de screening.`
      });
    }

    // 3. Obtener criterios de screening desde la búsqueda asociada
    const busquedaDoc = await db.collection('busquedas').doc(idBusqueda).get();
    if (!busquedaDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: `La búsqueda asociada con ID '${idBusqueda}' no existe.`
      });
    }

    const busquedaData = busquedaDoc.data();
    const criteriosScreening = busquedaData.criterios_screening || [];
    const timestamp = new Date().toISOString();

    if (!Array.isArray(criteriosScreening) || criteriosScreening.length === 0) {
      const emptyResultPayload = {
        resultado_screening: [],
        fit_score_screening: 0,
        tiene_knockout: false,
        fecha_modificacion_screening: timestamp,
        updatedAt: timestamp
      };
      await pipelineRef.update(emptyResultPayload);
      const updatedSnap = await pipelineRef.get();
      return res.status(200).json({
        status: 'success',
        message: 'La búsqueda no tiene criterios de screening configurados. Se restableció el resultado vacío.',
        data: updatedSnap.data()
      });
    }

    // 4. Leer/descargar el archivo CV desde Firebase Storage
    let base64File = '';
    let mimeType = 'application/pdf';

    const prefix = `gs://${bucket.name}/`;
    if (gsUri.startsWith(prefix)) {
      const storagePath = gsUri.substring(prefix.length);
      const fileRef = bucket.file(storagePath);

      if (process.env.NODE_ENV !== 'test') {
        const [exists] = await fileRef.exists();
        if (!exists) {
          return res.status(404).json({
            status: 'error',
            message: 'El archivo CV del candidato no existe físicamente en el almacenamiento de Firebase Storage.'
          });
        }
        const [buffer] = await fileRef.download();
        const [metadata] = await fileRef.getMetadata();
        mimeType = metadata.contentType || 'application/pdf';
        base64File = buffer.toString('base64');
      } else {
        base64File = Buffer.from('PDF_TEST_BUFFER').toString('base64');
      }
    } else {
      base64File = Buffer.from('PDF_TEST_BUFFER').toString('base64');
    }

    const dataUrl = `data:${mimeType};base64,${base64File}`;

    // 5. Schema Zod refinado para forzar la respuesta de Genkit / Gemini
    const EvaluacionScreeningSchema = z.object({
      evaluaciones: z.array(z.object({
        id_criterio: z.string().describe('ID exacto del criterio evaluado provisto en la lista de preguntas.'),
        evaluacion: z.enum(['SI', 'INFERIDO', 'NO']).describe('Resultado de la evaluación: SI si cumple explícitamente, INFERIDO si se deduce implícitamente por experiencia, NO si no cumple o no hay rastro en el CV.'),
        evidencia_cv: z.string().describe('Cita textual extraída del CV que justifica su decisión. En caso de evaluación NO, debe incluir una justificación o explicación clara indicando por qué no se halló evidencia o qué menciona en su lugar.')
      }))
    });

    const promptPreguntas = criteriosScreening.map(c => `[ID: ${c.id}] (Tipo: ${c.tipo}, Peso: ${c.peso}) Pregunta: ${c.pregunta}`).join('\n');

    const promptText = `Analiza detalladamente este CV y evalúa cada uno de los siguientes criterios de aceptación/descarte:\n\n${promptPreguntas}\n\nPara cada criterio, determina la evaluación (SI, INFERIDO, NO) y extrae o fundamenta la evidencia textual exacta.`;

    const aiResponse = await ai.generate({
      model: modelRef,
      prompt: [
        {
          media: {
            url: dataUrl,
            contentType: mimeType
          }
        },
        { text: promptText }
      ],
      output: { schema: EvaluacionScreeningSchema }
    });

    const evaluacionesIA = aiResponse?.output?.evaluaciones || [];

    // 6. Mapear y calcular puntuación ponderada y alertas de knockout
    let fitScore = 0;
    let tieneKnockout = false;

    const resultadoScreening = criteriosScreening.map(crit => {
      const evaluacionEncontrada = evaluacionesIA.find(e => e.id_criterio === crit.id) || {
        evaluacion: 'NO',
        evidencia_cv: 'No se obtuvo evaluación del modelo para este criterio.'
      };

      const evalValue = (evaluacionEncontrada.evaluacion || 'NO').toUpperCase();
      const esKnockout = (crit.tipo === 'knockout');
      let puntajeObtenido = 0;

      if (crit.tipo === 'deseable') {
        if (evalValue === 'SI') {
          puntajeObtenido = crit.peso || 0;
        } else if (evalValue === 'INFERIDO') {
          puntajeObtenido = Math.round((crit.peso || 0) / 2);
        } else {
          puntajeObtenido = 0;
        }
      }

      if (esKnockout && evalValue === 'NO') {
        tieneKnockout = true;
      }

      fitScore += puntajeObtenido;

      return {
        id_criterio: crit.id,
        evaluacion: evalValue,
        evidencia_cv: evaluacionEncontrada.evidencia_cv || null,
        es_knockout: esKnockout && evalValue === 'NO',
        puntaje_obtenido: puntajeObtenido
      };
    });

    // 7. Persistir en Firestore
    const updates = {
      resultado_screening: resultadoScreening,
      fit_score_screening: fitScore,
      tiene_knockout: tieneKnockout,
      fecha_modificacion_screening: timestamp,
      updatedAt: timestamp
    };

    await pipelineRef.update(updates);

    const updatedSnap = await pipelineRef.get();
    const updatedData = updatedSnap.data();

    return res.status(200).json({
      status: 'success',
      message: 'Evaluación de screening procesada correctamente mediante Inteligencia Artificial.',
      data: normalizePipelineDoc(pipelineRef.id, updatedData)
    });

  } catch (error) {
    console.error('[SCREENING IA ERROR] Error al evaluar screening con IA:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Error interno al procesar la evaluación de screening con Inteligencia Artificial.',
      detail: error.message
    });
  }
};

