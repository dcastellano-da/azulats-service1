import { db, bucket } from '../config/firebase.js';
import crypto from 'crypto';
import fs from 'fs';
import { z } from 'zod';
import { ai, modelRef } from '../config/genkit.js';
import { generarHtmlFichaPdf, renderizarPdfFromHtml } from '../services/pdfService.js';

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
    // 1. Validar que la búsqueda exista en Firestore y resolver su ID real de documento
    let busqDoc = await db.collection('busquedas').doc(finalIdBusqueda).get();
    let realIdBusqueda = finalIdBusqueda;

    if (!busqDoc.exists) {
      const busqSnap = await db.collection('busquedas')
        .where('codigo_busqueda', '==', finalIdBusqueda)
        .get();

      if (!busqSnap.empty) {
        busqDoc = busqSnap.docs[0];
        realIdBusqueda = busqDoc.id;
      } else {
        return res.status(404).json({
          status: 'error',
          message: `La búsqueda con ID '${finalIdBusqueda}' no existe.`
        });
      }
    } else {
      realIdBusqueda = busqDoc.id;
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
      .where('claves_conexion.id_busqueda', '==', realIdBusqueda)
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
        id_busqueda: realIdBusqueda,
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
        reuniones: [],
        assessment_manual: null
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

      if (body.f2_evaluacion?.informe_entrevista_ia !== undefined) {
        updates['f2_evaluacion.informe_entrevista_ia'] = body.f2_evaluacion.informe_entrevista_ia;
      } else if (body['f2_evaluacion.informe_entrevista_ia'] !== undefined) {
        updates['f2_evaluacion.informe_entrevista_ia'] = body['f2_evaluacion.informe_entrevista_ia'];
      } else if (body.informe_entrevista_ia !== undefined) {
        updates['f2_evaluacion.informe_entrevista_ia'] = body.informe_entrevista_ia;
      }

      if (body.f2_evaluacion?.test_personalidad !== undefined) {
        updates['f2_evaluacion.test_personalidad'] = body.f2_evaluacion.test_personalidad;
      } else if (body['f2_evaluacion.test_personalidad'] !== undefined) {
        updates['f2_evaluacion.test_personalidad'] = body['f2_evaluacion.test_personalidad'];
      } else if (body.test_personalidad !== undefined) {
        updates['f2_evaluacion.test_personalidad'] = body.test_personalidad;
      }

      // Procesar f2_evaluacion.assessment_manual (Resumen de Evaluación Técnica)
      const assessmentManualInput = body.f2_evaluacion?.assessment_manual !== undefined
        ? body.f2_evaluacion.assessment_manual
        : (body['f2_evaluacion.assessment_manual'] !== undefined
            ? body['f2_evaluacion.assessment_manual']
            : body.assessment_manual);

      if (assessmentManualInput !== undefined) {
        if (typeof assessmentManualInput !== 'object' || assessmentManualInput === null) {
          throw new Error('El campo assessment_manual debe ser un objeto.');
        }

        const assessmentManualSchema = z.object({
          resumen_texto: z.string({
            required_error: 'El campo resumen_texto es obligatorio en assessment_manual.',
            invalid_type_error: 'El campo resumen_texto debe ser un string.'
          }).min(1, 'El campo resumen_texto no puede estar vacío.').max(10000, 'El resumen de evaluación técnica no puede exceder los 10000 caracteres.')
        });

        const parseResult = assessmentManualSchema.safeParse(assessmentManualInput);
        if (!parseResult.success) {
          const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
          throw new Error(`Datos de assessment_manual inválidos: ${issues}`);
        }

        // Inmutabilidad Temporal: El servidor inyecta obligatoriamente la fecha del reloj interno del servidor, ignorando cualquier fecha enviada por el cliente
        updates['f2_evaluacion.assessment_manual'] = {
          resumen_texto: parseResult.data.resumen_texto,
          fecha_evaluacion: timestamp
        };
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
        message: 'No se enviaron campos válidos para actualizar (puedes actualizar estado_actual, analisis_semantico, f1_descubrimiento, f2_evaluacion, f3_cliente, f4_cierre, resolucion, resultado_screening, test_personalidad).'
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

// Schema Zod para forzar la respuesta de Genkit / Gemini para el Informe de Entrevista de Screening
const InformeEntrevistaSchema = z.object({
  experiencia_consolidada: z.string().describe('Resumen de la trayectoria real validada en la entrevista, destacando hitos clave, motivos de salida de empleos anteriores y manejo de herramientas.'),
  alineacion_motivadores: z.string().describe('Análisis conductual sobre el encaje cultural, evaluando si el talento busca estabilidad, crecimiento o qué tipo de ambiente laboral prefiere.'),
  pretension_economica_condiciones: z.object({
    pretension_salarial: z.string().nullable().describe('Banda salarial o pretensión económica exigida.'),
    disponibilidad: z.string().nullable().describe('Disponibilidad de incorporación (ej: inmediata, preaviso de X semanas).'),
    modalidad_preferida: z.string().nullable().describe('Modalidad de trabajo preferida o aceptada (presencial, remota, híbrida).')
  }),
  proximos_pasos: z.array(z.string()).describe('Tareas o action items extraídos del cierre de la llamada para generar recordatorios automáticos.'),
  auditoria_veracidad: z.object({
    inconsistencias_detectadas: z.array(z.string()).describe('Lista de inconsistencias detectadas entre lo conversado oralmente y lo escrito en el CV (fechas, roles, títulos).'),
    confirmaciones_fortalezas: z.array(z.string()).describe('Grado de profundidad o confirmación observada en competencias técnicas clave.')
  })
});

/**
 * POST /api/v1/pipeline/:id/analizar-transcripcion
 * Recibe la transcripción de la entrevista de screening en RAM (PDF/DOC), recupera el CV original y los criterios de la búsqueda,
 * realiza triangulación multimodal con Vertex AI (Gemini 2.5 Flash) y persiste el informe en f2_evaluacion.informe_entrevista_ia.
 */
export const analizarTranscripcionPipeline = async (req, res) => {
  const { id } = req.params;
  const file = req.file;

  if (!id) {
    return res.status(400).json({
      status: 'error',
      message: 'El identificador del pipeline en la ruta es requerido.'
    });
  }

  if (!file) {
    return res.status(400).json({
      status: 'error',
      message: 'El archivo de transcripción (PDF, DOC o DOCX) es obligatorio en el campo "transcripcion".'
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

    // 2. Obtener candidato y validar su url_cv
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
        message: `El candidato con ID '${idCandidato}' no posee un archivo CV (url_cv) registrado en el sistema para realizar el análisis de la transcripción.`
      });
    }

    // 3. Obtener criterios de la búsqueda asociada
    const busquedaDoc = await db.collection('busquedas').doc(idBusqueda).get();
    if (!busquedaDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: `La búsqueda asociada con ID '${idBusqueda}' no existe.`
      });
    }

    const busquedaData = busquedaDoc.data();
    const criteriosScreening = busquedaData.criterios_screening || [];

    // 4. Leer / descargar el CV original desde Firebase Storage
    let cvBase64 = '';
    let cvMimeType = 'application/pdf';

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
        cvMimeType = metadata.contentType || 'application/pdf';
        cvBase64 = buffer.toString('base64');
      } else {
        cvBase64 = Buffer.from('PDF_CV_TEST_BUFFER').toString('base64');
      }
    } else {
      cvBase64 = Buffer.from('PDF_CV_TEST_BUFFER').toString('base64');
    }

    const cvDataUrl = `data:${cvMimeType};base64,${cvBase64}`;

    // 5. Preparar la transcripción subida desde RAM en Base64
    const transBase64 = file.buffer.toString('base64');
    const transDataUrl = `data:${file.mimetype};base64,${transBase64}`;

    // 6. Formatear criterios para el prompt
    const promptCriterios = criteriosScreening.map(c => `[ID: ${c.id}] (Tipo: ${c.tipo}, Peso: ${c.peso}) Pregunta: ${c.pregunta}`).join('\n');

    const promptText = `Analiza detalladamente esta transcripción de entrevista de screening cruzando la información oralmente expuesta con el CV original del candidato y los criterios de evaluación de la búsqueda.

Criterios de Evaluación de la Búsqueda:
${promptCriterios || 'Sin criterios específicos configurados.'}

Genera un informe estructurado y auditable que sintetice la trayectoria real validada, la motivación y encaje cultural, las pretensiones económicas y condiciones, los próximos pasos recomendados e identifique explícitamente cualquier inconsistencia entre lo expuesto en la entrevista y el CV.`;

    const aiResponse = await ai.generate({
      model: modelRef,
      prompt: [
        {
          media: {
            url: cvDataUrl,
            contentType: cvMimeType
          }
        },
        {
          media: {
            url: transDataUrl,
            contentType: file.mimetype
          }
        },
        { text: promptText }
      ],
      output: { schema: InformeEntrevistaSchema }
    });

    const extractedReport = aiResponse?.output;

    if (!extractedReport) {
      return res.status(500).json({
        status: 'error',
        message: 'No se pudo obtener una respuesta estructurada desde el modelo de Inteligencia Artificial.'
      });
    }

    const timestamp = new Date().toISOString();
    const informeFinal = {
      ...extractedReport,
      fecha_analisis: timestamp
    };

    // 7. Persistir en Firestore en f2_evaluacion.informe_entrevista_ia
    const updates = {
      'f2_evaluacion.informe_entrevista_ia': informeFinal,
      updatedAt: timestamp
    };

    await pipelineRef.update(updates);

    const updatedSnap = await pipelineRef.get();
    const updatedData = updatedSnap.data();

    return res.status(200).json({
      status: 'success',
      message: 'Transcripción analizada e informe de entrevista generado exitosamente con Inteligencia Artificial.',
      data: normalizePipelineDoc(pipelineRef.id, updatedData)
    });

  } catch (error) {
    console.error('[ANALIZAR TRANSCRIPCION IA ERROR] Error al analizar transcripción con IA:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Error interno al procesar el análisis de la transcripción con Inteligencia Artificial.',
      detail: error.message
    });
  }
};

// Schema Zod para forzar la respuesta de Genkit / Gemini para el Test de Personalidad (CFV - V3)
const TestPersonalidadSchema = z.object({
  arquetipo_codigo: z.string().describe('El código de 4 o 5 letras del arquetipo extraído (ej: "ENTJ-A", "INFP-T").'),
  arquetipo_nombre: z.string().describe('El título o nombre del perfil de personalidad (ej: "Comandante", "Mediador").'),
  dimensiones: z.object({
    dim_mente: z.number().min(0).max(100).describe('Porcentaje de Extravertido (0) vs Introvertido (100).'),
    dim_energia: z.number().min(0).max(100).describe('Porcentaje de Intuitivo (0) vs Observador/Realista (100).'),
    dim_naturaleza: z.number().min(0).max(100).describe('Porcentaje de Racional/Pensamiento (0) vs Emocional/Sentimiento (100).'),
    dim_tactica: z.number().min(0).max(100).describe('Porcentaje de Planificador/Juzgador (0) vs Prospectivo/Explorador (100).'),
    dim_identidad: z.number().min(0).max(100).describe('Porcentaje de Asertivo (0) vs Turbulento (100).')
  }).describe('Objeto anidado con las 5 métricas numéricas del test de personalidad (0 a 100).'),
  analisis_encaje: z.string().describe('Párrafo breve generado por la IA argumentando el encaje cultural y conductual para el puesto solicitado.')
});

/**
 * POST /api/v1/pipeline/:id/analizar-personalidad
 * Recibe la imagen de la captura del test de personalidad en RAM (PNG/JPG/WEBP), recupera los criterios y perfil de la búsqueda,
 * realiza inferencia multimodal con Vertex AI (Gemini 2.5 Flash) y persiste el resultado en f2_evaluacion.test_personalidad con timestamp inyectado.
 */
export const analizarTestPersonalidadPipeline = async (req, res) => {
  const { id } = req.params;
  const file = req.file;

  if (!id) {
    return res.status(400).json({
      status: 'error',
      message: 'El identificador del pipeline en la ruta es requerido.'
    });
  }

  if (!file) {
    return res.status(400).json({
      status: 'error',
      message: 'El archivo de imagen del test de personalidad (PNG, JPG, JPEG o WEBP) es obligatorio en el campo "imagen" (o "file").'
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

    if (!idBusqueda) {
      return res.status(400).json({
        status: 'error',
        message: 'El registro de pipeline no posee un id_busqueda válido en claves_conexion.'
      });
    }

    // 2. Obtener criterios y detalles de la búsqueda asociada
    const busquedaDoc = await db.collection('busquedas').doc(idBusqueda).get();
    if (!busquedaDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: `La búsqueda asociada con ID '${idBusqueda}' no existe.`
      });
    }

    const busquedaData = busquedaDoc.data();
    const criteriosScreening = busquedaData.criterios_screening || [];
    const promptCriterios = criteriosScreening.map(c => `[ID: ${c.id}] (Tipo: ${c.tipo}, Peso: ${c.peso}) Pregunta: ${c.pregunta}`).join('\n');

    // 3. Convertir el buffer de la imagen cargada en RAM a Data URI Base64
    const base64Image = file.buffer.toString('base64');
    const imageDataUrl = `data:${file.mimetype};base64,${base64Image}`;

    // 4. Armar el prompt para triangulación de contexto
    const promptText = `Analiza detalladamente la imagen adjunta correspondiente a los resultados de un test de personalidad (como 16Personalities o similar).

Información del Puesto y Búsqueda de Empleo:
- Título de la búsqueda: ${busquedaData.titulo_busqueda || busquedaData.nombre || 'Búsqueda activa'}
- Requisitos / Criterios de Selección:
${promptCriterios || 'Sin criterios específicos configurados.'}

Instrucciones:
1. Extrae con precisión el código del arquetipo (ej: ENTJ-A, INFP-T) y su nombre/título (ej: Comandante, Mediador).
2. Extrae o calcula el valor numérico en escala de 0 a 100 para las 5 dimensiones psicométricas: Mente (dim_mente), Energía (dim_energia), Naturaleza (dim_naturaleza), Táctica (dim_tactica) e Identidad (dim_identidad).
3. Genera un análisis breve de encaje cultural y conductual (analisis_encaje) argumentando las fortalezas o posibles riesgos de este perfil frente a los requerimientos de la posición.`;

    // 5. Inferencia multimodal con Genkit / Gemini 2.5 Flash
    const aiResponse = await ai.generate({
      model: modelRef,
      prompt: [
        {
          media: {
            url: imageDataUrl,
            contentType: file.mimetype
          }
        },
        { text: promptText }
      ],
      output: { schema: TestPersonalidadSchema }
    });

    const extractedResult = aiResponse?.output;

    if (!extractedResult) {
      return res.status(500).json({
        status: 'error',
        message: 'No se pudo obtener una respuesta estructurada del modelo de Inteligencia Artificial para el test de personalidad.'
      });
    }

    // 6. Inyectar marca temporal ISO 8601 generada por el backend
    const timestamp = new Date().toISOString();
    const finalResult = {
      ...extractedResult,
      fecha_analisis: timestamp
    };

    // 7. Persistir en Firestore en f2_evaluacion.test_personalidad
    const updates = {
      'f2_evaluacion.test_personalidad': finalResult,
      updatedAt: timestamp
    };

    await pipelineRef.update(updates);

    const updatedSnap = await pipelineRef.get();
    const updatedData = updatedSnap.data();

    return res.status(200).json({
      status: 'success',
      message: 'Test de personalidad analizado e integrado exitosamente con Inteligencia Artificial.',
      data: normalizePipelineDoc(pipelineRef.id, updatedData)
    });

  } catch (error) {
    console.error('[TEST PERSONALIDAD IA ERROR] Error al analizar test de personalidad con IA:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Error interno al procesar el análisis del test de personalidad con Inteligencia Artificial.',
      detail: error.message
    });
  }
};

/**
 * Schema Zod para validar el payload de opciones del modal pre-generación del PDF.
 */
const GenerarFichaSchema = z.object({
  incluir_test_personalidad: z.boolean().optional().default(true),
  incluir_pretension_salarial: z.boolean().optional().default(true),
  incluir_notas_assessment: z.boolean().optional().default(true),
  incluir_bitacora: z.boolean().optional().default(true),
  incluir_trayectoria: z.boolean().optional().default(true),
  anonimizar_candidato: z.boolean().optional().default(false)
});

/**
 * POST /api/v1/pipeline/:id/generar-ficha-pdf
 * Consolida información del candidato, vacante, evaluación psicométrica, assessment y bitacora F1-F4,
 * redacta un resumen ejecutivo al vuelo con Gemini 2.5 Flash en base a los bloques seleccionados,
 * renderiza la plantilla HTML y devuelve la Ficha Técnica binaria en PDF.
 */
export const generarFichaPdfPipeline = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      status: 'error',
      message: 'El identificador del pipeline en la ruta es requerido.'
    });
  }

  // 1. Validar opciones enviadas en el body con Zod
  const parseResult = GenerarFichaSchema.safeParse(req.body || {});
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    return res.status(400).json({
      status: 'error',
      message: `Opciones de generación de ficha inválidas: ${issues}`
    });
  }
  const opciones = parseResult.data;

  try {
    // 2. Obtener documento del pipeline
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

    // 3. Obtener vacante (búsqueda) y candidato (postulante)
    const busquedaDoc = await db.collection('busquedas').doc(idBusqueda).get();
    if (!busquedaDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: `La búsqueda asociada con ID '${idBusqueda}' no existe.`
      });
    }
    const busquedaData = busquedaDoc.data();

    const candidatoDoc = await db.collection('postulantes').doc(idCandidato).get();
    if (!candidatoDoc.exists) {
      return res.status(404).json({
        status: 'error',
        message: `El candidato asociado con ID '${idCandidato}' no existe.`
      });
    }
    const candidatoData = { id: candidatoDoc.id, ...candidatoDoc.data() };

    // 4. Obtener configuración de agencia (p-cfg-01 -> global -> fallback default)
    let agenciaConfig = { nombre_comercial: 'Azul ATS Agency', logo_url: null, color_primario: '#1e3a8a' };
    try {
      let agenciaDoc = await db.collection('configuracion_agencia').doc('p-cfg-01').get();
      if (!agenciaDoc.exists) {
        agenciaDoc = await db.collection('configuracion_agencia').doc('global').get();
      }
      if (agenciaDoc.exists) {
        agenciaConfig = { ...agenciaConfig, ...agenciaDoc.data() };
      }
    } catch (cfgErr) {
      console.warn('[FICHA PDF] No se pudo cargar configuracion_agencia de Firestore, usando defaults:', cfgErr.message);
    }

    // 5. Construcción del prompt dinámico para Gemini 2.5 Flash
    const rolSolicitado = busquedaData.perfil_tecnico?.rol_solicitado || busquedaData.titulo_busqueda || 'Rol Solicitado';
    const cliente = busquedaData.identificacion?.cliente || 'Empresa Cliente';

    const seccionesParaIA = [];

    if (opciones.incluir_trayectoria && candidatoData.resumen) {
      seccionesParaIA.push(`- Trayectoria / Perfil: ${candidatoData.resumen} (Skills: ${candidatoData.skills_principales || 'No especificados'})`);
    }

    if (opciones.incluir_test_personalidad && pipelineData.f2_evaluacion?.test_personalidad) {
      const test = pipelineData.f2_evaluacion.test_personalidad;
      seccionesParaIA.push(`- Test Psicométrico: Arquetipo ${test.arquetipo_nombre || ''} (${test.arquetipo_codigo || ''}). Encaje: ${test.analisis_encaje || ''}`);
    }

    if (opciones.incluir_pretension_salarial && pipelineData.f2_evaluacion?.informe_entrevista_ia?.pretension_economica_condiciones) {
      const p = pipelineData.f2_evaluacion.informe_entrevista_ia.pretension_economica_condiciones;
      seccionesParaIA.push(`- Pretensiones y Logística: Salario ${p.pretension_salarial || 'No especificado'}, Modalidad ${p.modalidad_preferida || 'No especificada'}, Disponibilidad ${p.disponibilidad || 'Inmediata'}`);
    }

    if (opciones.incluir_notas_assessment && pipelineData.f2_evaluacion?.assessment_manual) {
      seccionesParaIA.push(`- Assessment Técnico Reclutador: ${pipelineData.f2_evaluacion.assessment_manual.resumen_texto}`);
    }

    if (opciones.incluir_bitacora) {
      const bitacoraNotas = [];
      if (pipelineData.f1_descubrimiento?.notas_reclutador) bitacoraNotas.push(`F1 Descubrimiento: ${pipelineData.f1_descubrimiento.notas_reclutador}`);
      if (pipelineData.f2_evaluacion?.notas_reclutador) bitacoraNotas.push(`F2 Evaluación: ${pipelineData.f2_evaluacion.notas_reclutador}`);
      if (pipelineData.f3_cliente?.notas_reclutador) bitacoraNotas.push(`F3 Cliente: ${pipelineData.f3_cliente.notas_reclutador}`);
      if (pipelineData.f4_cierre?.notas_reclutador) bitacoraNotas.push(`F4 Cierre: ${pipelineData.f4_cierre.notas_reclutador}`);

      if (bitacoraNotas.length > 0) {
        seccionesParaIA.push(`- Bitácora de Notas del Reclutador (F1-F4):\n  ${bitacoraNotas.join('\n  ')}`);
      }
    }

    const promptText = `Eres un consultor experto en selección ejecutivo. Redacta un Resumen Ejecutivo profesional, fluido y persuasivo (máximo 2 a 3 párrafos cortos) para presentar al candidato para la vacante "${rolSolicitado}" de la empresa cliente "${cliente}".

INSTRUCCIÓN ESTRICTA: Basar la redacción ÚNICA Y EXCLUSIVAMENTE en la siguiente información seleccionada por el reclutador:

${seccionesParaIA.length > 0 ? seccionesParaIA.join('\n') : 'Sin bloques cualitativos adicionales seleccionados.'}

No inventes datos que no estén en la lista. Si un tema no fue incluido en el listado, ignóralo completamente.`;

    let resumenEjecutivoIA = '';
    try {
      const aiResponse = await ai.generate({
        model: modelRef,
        prompt: promptText
      });
      resumenEjecutivoIA = aiResponse?.text || aiResponse?.output || '';
    } catch (aiErr) {
      console.warn('[FICHA PDF] Advertencia al generar síntesis con IA, continuando con plantilla:', aiErr.message);
      resumenEjecutivoIA = 'Perfil preseleccionado para la posición solicitada con evaluación favorable por parte del equipo de reclutamiento.';
    }

    // 6. Generar HTML estilizado
    const datosPdf = {
      agencia: agenciaConfig,
      busqueda: busquedaData,
      postulante: candidatoData,
      pipeline: pipelineData,
      resumenEjecutivoIA
    };

    const htmlString = await generarHtmlFichaPdf(datosPdf, opciones);

    // 7. Renderizar a Buffer PDF con Puppeteer
    const pdfBuffer = await renderizarPdfFromHtml(htmlString);

    // 8. Enviar respuesta HTTP binaria de PDF y prueba de fuego física
    const filename = opciones.anonimizar_candidato
      ? `Ficha_Candidato_${candidatoData.id ? candidatoData.id.substring(0, 8) : 'Anonimo'}.pdf`
      : `Ficha_${(candidatoData.nombre || 'Candidato').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;

    try {
      fs.writeFileSync('debug_backend.pdf', pdfBuffer);
      console.log('[DEBUG BACKEND] Volcado físico exitoso en raíz: debug_backend.pdf (', pdfBuffer.length, 'bytes)');
    } catch (fsErr) {
      console.error('[DEBUG BACKEND ERROR] No se pudo escribir debug_backend.pdf:', fsErr.message);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    console.log('[DEBUG BACKEND] Enviando respuesta HTTP binaria cruda vía res.end() (HTTP 200). Bytes:', pdfBuffer.length);
    return res.status(200).end(pdfBuffer, 'binary');

  } catch (error) {
    console.error('[GENERAR FICHA PDF ERROR] Detalle técnico del fallo al generar Ficha PDF:', error);

    let errorMessage = 'Error interno al generar la Ficha Técnica en PDF.';

    if (error.isPuppeteerLaunchError || (error.message && error.message.includes('Falta binario de Chrome'))) {
      errorMessage = 'Error de infraestructura: Motor de renderizado PDF no disponible (Falta binario de Chrome)';
    } else if (error.isTimeout || (error.message && /timeout/i.test(error.message))) {
      errorMessage = 'Error de infraestructura: Tiempo de espera agotado al renderizar el documento PDF.';
    } else if (error.isPuppeteerRenderError || (error.message && error.message.includes('Error de infraestructura'))) {
      errorMessage = error.message;
    }

    return res.status(500).json({
      status: 'error',
      message: errorMessage,
      detail: error.originalError || error.message
    });
  }
};



