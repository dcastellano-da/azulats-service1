import { db } from '../config/firebase.js';
import { bigquery } from '../config/bigquery.js';

/**
 * Controlador para la gestión de búsquedas de Azul ATS.
 * Implementa Escritura Dual en Firestore y BigQuery.
 */
export const crearBusqueda = async (req, res) => {
  const {
    cliente,
    perfil_busqueda,
    estado_fase,
    responsable_operativo,
    responsable_validacion,
    fecha_inicio_objetivo
  } = req.body;

  // Validación de campos obligatorios
  if (
    !cliente ||
    !perfil_busqueda ||
    !estado_fase ||
    !responsable_operativo ||
    !responsable_validacion ||
    !fecha_inicio_objetivo
  ) {
    return res.status(400).json({
      status: 'error',
      message: 'Todos lo campos son obligatorios: cliente, perfil_busqueda, estado_fase, responsable_operativo, responsable_validacion, fecha_inicio_objetivo.'
    });
  }

  // Generación de ID en Firestore antes de guardar
  const nuevaBusquedaRef = db.collection('busquedas').doc();
  const idBusqueda = nuevaBusquedaRef.id;

  // Mapeo adaptado para Firestore
  const documentoFirestore = {
    cliente,
    perfil_busqueda,
    estado_fase,
    responsable_operativo,
    responsable_validacion,
    fecha_inicio_objetivo,
    metricas_tracking: { 
      dias_previstos_previa: 3, 
      busqueda_avance: 0 
    },
    contexto_ia: { 
      prompt_base: "Analizar perfil según requisitos técnicos de la vacante." 
    },
    fecha_creacion: new Date().toISOString()
  };

  // Mapeo estricto para BigQuery (Schema Mismatch resolution)
  const documentoBigQuery = {
    id_busqueda: idBusqueda,
    cliente: cliente,
    puesto: perfil_busqueda,
    reclutador_asignado_email: `${responsable_operativo}@digitalagil.com`,
    id_carpeta_recibidos: 'PENDIENTE_CREACION',
    id_planilla: null,
    estado: 'ACTIVA'
  };

  // Definición de promesas con mapeados específicos
  const writeToFirestore = nuevaBusquedaRef.set(documentoFirestore);
  
  const writeToBigQuery = bigquery
    .dataset('db_reclutamiento1')
    .table('maestro_busquedas')
    .insert(documentoBigQuery);

  // Ejecución coordinada de Escritura Dual
  const results = await Promise.allSettled([writeToFirestore, writeToBigQuery]);

  const firestoreResult = results[0];
  const bigQueryResult = results[1];

  const firestoreSuccess = firestoreResult.status === 'fulfilled';
  const bigQuerySuccess = bigQueryResult.status === 'fulfilled';

  const syncDetails = {
    firestore: {
      status: firestoreResult.status,
      id: firestoreSuccess ? idBusqueda : null,
      error: !firestoreSuccess ? firestoreResult.reason.message || firestoreResult.reason : null
    },
    bigquery: {
      status: bigQueryResult.status,
      error: !bigQuerySuccess ? bigQueryResult.reason.message || bigQueryResult.reason : null
    }
  };

  // Escenario 1: Ambos fallan
  if (!firestoreSuccess && !bigQuerySuccess) {
    return res.status(500).json({
      status: 'error',
      message: 'Fallo crítico de sincronización: Escritura Dual ha fallado en ambos sistemas (Firestore y BigQuery).',
      sync: syncDetails
    });
  }

  // Escenario 2: Sincronización parcial (Al menos uno falló pero otro tuvo éxito)
  if (!firestoreSuccess || !bigQuerySuccess) {
    return res.status(207).json({
      status: 'multi-status',
      message: 'Escritura Dual completada parcialmente. Se presentaron fallos de consistencia.',
      data: {
        id_busqueda: idBusqueda,
        firestore: documentoFirestore,
        bigquery: documentoBigQuery
      },
      sync: syncDetails
    });
  }

  // Escenario 3: Éxito total
  return res.status(201).json({
    status: 'success',
    message: 'Búsqueda registrada exitosamente en todos los sistemas (Firestore y BigQuery) con esquemas alineados.',
    data: {
      id_busqueda: idBusqueda,
      firestore: documentoFirestore,
      bigquery: documentoBigQuery
    },
    sync: syncDetails
  });
};

// ---------------------------------------------------------------------------

/**
 * GET /api/v1/busquedas
 * Lista todas las búsquedas desde Firestore (fuente transaccional).
 * Requiere header Authorization: Bearer <token_firebase>
 */
export const obtenerBusquedas = async (req, res) => {
  try {
    const snapshot = await db.collection('busquedas').get();

    const busquedas = snapshot.docs.map(doc => ({
      id: doc.id,        // ID de Firestore inyectado en el objeto
      ...doc.data()
    }));

    return res.status(200).json({
      status: 'success',
      total: busquedas.length,
      data: busquedas
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error al recuperar las búsquedas desde Firestore.',
      detail: error.message
    });
  }
};

// ---------------------------------------------------------------------------

/**
 * PATCH /api/v1/busquedas/:id
 * Actualiza campos de una búsqueda con Dual Write:
 *   - Firestore: update() sobre el documento por ID.
 *   - BigQuery: DML parametrizado si el body incluye estado_fase.
 * Requiere header Authorization: Bearer <token_firebase>
 */
export const actualizarBusqueda = async (req, res) => {
  const { id } = req.params;
  const camposActualizar = req.body;

  if (!id) {
    return res.status(400).json({
      status: 'error',
      message: 'El parámetro id es obligatorio.'
    });
  }

  if (!camposActualizar || Object.keys(camposActualizar).length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'El body de la petición no puede estar vacío.'
    });
  }

  // Promesa 1 — Firestore: actualización parcial con merge
  const updateFirestore = db.collection('busquedas').doc(id).update(camposActualizar);

  // Promesa 2 — BigQuery: DML parametrizado solo si hay cambio de estado
  let updateBigQuery;

  if (camposActualizar.estado_fase) {
    const query = `
      UPDATE \`ultra-bearing-492817-k6.db_reclutamiento1.maestro_busquedas\`
      SET estado = @estado
      WHERE id_busqueda = @id
    `;
    const options = {
      query,
      params: {
        estado: camposActualizar.estado_fase,
        id: id
      }
    };
    updateBigQuery = bigquery.query(options);
  } else {
    // Sin cambio de estado → la promesa analítica se resuelve inmediatamente
    updateBigQuery = Promise.resolve({ skipped: true, reason: 'Sin cambios de estado_fase — actualización BigQuery omitida.' });
  }

  // Ejecución coordinada de Dual Write Update
  const results = await Promise.allSettled([updateFirestore, updateBigQuery]);

  const firestoreResult = results[0];
  const bigQueryResult  = results[1];

  const firestoreSuccess = firestoreResult.status === 'fulfilled';
  const bigQuerySuccess  = bigQueryResult.status  === 'fulfilled';

  const syncDetails = {
    firestore: {
      status: firestoreResult.status,
      error: !firestoreSuccess ? firestoreResult.reason?.message || String(firestoreResult.reason) : null
    },
    bigquery: {
      status: bigQueryResult.status,
      skipped: bigQuerySuccess && bigQueryResult.value?.skipped === true,
      error: !bigQuerySuccess ? bigQueryResult.reason?.message || String(bigQueryResult.reason) : null
    }
  };

  // Escenario 1: Ambos fallan
  if (!firestoreSuccess && !bigQuerySuccess) {
    return res.status(500).json({
      status: 'error',
      message: 'Fallo crítico: la actualización falló en Firestore y BigQuery.',
      sync: syncDetails
    });
  }

  // Escenario 2: Fallo parcial
  if (!firestoreSuccess || !bigQuerySuccess) {
    return res.status(207).json({
      status: 'multi-status',
      message: 'Actualización completada parcialmente. Se presentaron fallos de consistencia.',
      id_busqueda: id,
      sync: syncDetails
    });
  }

  // Escenario 3: Éxito total
  return res.status(200).json({
    status: 'success',
    message: 'Búsqueda actualizada exitosamente en Firestore y BigQuery.',
    id_busqueda: id,
    campos_actualizados: Object.keys(camposActualizar),
    sync: syncDetails
  });
};
