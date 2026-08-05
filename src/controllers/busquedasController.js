import { db } from '../config/firebase.js';
import crypto from 'crypto';

/**
 * Valida y normaliza el arreglo de criterios de screening.
 * Genera un UUID inmutable v4 si el criterio no posee un id explícito.
 */
function parseAndValidateCriteriosScreening(criteriosInput) {
  if (criteriosInput === null || criteriosInput === undefined) {
    return [];
  }

  let list = criteriosInput;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (e) {
      throw new Error('El campo criterios_screening debe ser un JSON válido.');
    }
  }

  if (!Array.isArray(list)) {
    throw new Error('El campo criterios_screening debe ser un arreglo.');
  }

  return list.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`El criterio en el índice ${index} debe ser un objeto válido.`);
    }

    if (!item.pregunta || typeof item.pregunta !== 'string' || item.pregunta.trim() === '') {
      throw new Error(`El criterio en el índice ${index} debe incluir un texto válido en "pregunta".`);
    }

    const tipo = String(item.tipo || 'deseable').toLowerCase();
    if (tipo !== 'knockout' && tipo !== 'deseable') {
      throw new Error(`El criterio en el índice ${index} tiene un "tipo" inválido. Debe ser 'knockout' o 'deseable'.`);
    }

    const pesoNum = Number(item.peso);
    const peso = isNaN(pesoNum) || pesoNum < 0 ? 0 : pesoNum;

    return {
      id: item.id || crypto.randomUUID(),
      pregunta: item.pregunta.trim(),
      tipo: tipo,
      peso: tipo === 'knockout' ? 0 : peso
    };
  });
}

/**
 * Controlador para la gestión de búsquedas de Azul ATS.
 * Almacena los registros únicamente en Firestore (suspensión de BigQuery).
 */
export const crearBusqueda = async (req, res) => {
  const {
    identificacion,
    perfil_tecnico,
    condiciones,
    estado_sla,
    criterios_screening: criteriosScreeningInput,
    id_busqueda
  } = req.body;

  // Validación de campos obligatorios
  if (
    !identificacion ||
    !identificacion.cliente ||
    !perfil_tecnico ||
    !perfil_tecnico.rol_solicitado ||
    !estado_sla ||
    !estado_sla.estado_busqueda
  ) {
    return res.status(400).json({
      status: 'error',
      message: 'Los bloques identificacion (con cliente), perfil_tecnico (con rol_solicitado) y estado_sla (con estado_busqueda) son obligatorios.'
    });
  }

  let criterios_screening = [];
  if (criteriosScreeningInput !== undefined) {
    try {
      criterios_screening = parseAndValidateCriteriosScreening(criteriosScreeningInput);
    } catch (err) {
      return res.status(400).json({
        status: 'error',
        message: err.message
      });
    }
  }

  // Generación de ID en Firestore si no se pasa uno por parámetro
  const nuevaBusquedaRef = db.collection('busquedas').doc();
  const idBusquedaReal = id_busqueda || nuevaBusquedaRef.id;
  const docRef = db.collection('busquedas').doc(idBusquedaReal);

  const documentoFirestore = {
    id_busqueda: idBusquedaReal,
    identificacion: {
      cliente: identificacion.cliente,
      hiring_manager: identificacion.hiring_manager || null,
      fecha_apertura: identificacion.fecha_apertura || new Date().toISOString()
    },
    perfil_tecnico: {
      rol_solicitado: perfil_tecnico.rol_solicitado,
      seniority: perfil_tecnico.seniority || null,
      skills_excluyentes: Array.isArray(perfil_tecnico.skills_excluyentes) ? perfil_tecnico.skills_excluyentes : [],
      skills_deseables: Array.isArray(perfil_tecnico.skills_deseables) ? perfil_tecnico.skills_deseables : [],
      nivel_ingles_req: perfil_tecnico.nivel_ingles_req || null
    },
    condiciones: {
      modalidad: condiciones?.modalidad || null,
      zona_horaria_ubicacion: condiciones?.zona_horaria_ubicacion || null
    },
    estado_sla: {
      presupuesto_max: estado_sla.presupuesto_max || null,
      estado_busqueda: estado_sla.estado_busqueda,
      prioridad: estado_sla.prioridad || 'Normal',
      link_job_description: estado_sla.link_job_description || null
    },
    criterios_screening,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    await docRef.set(documentoFirestore);

    return res.status(201).json({
      status: 'success',
      message: 'Búsqueda registrada exitosamente en Firestore.',
      data: documentoFirestore
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error al registrar la búsqueda en Firestore.',
      detail: error.message
    });
  }
};

// ---------------------------------------------------------------------------

/**
 * GET /api/v1/busquedas
 * Lista todas las búsquedas desde Firestore.
 * Requiere header Authorization: Bearer <token_firebase>
 */
export const obtenerBusquedas = async (req, res) => {
  try {
    const snapshot = await db.collection('busquedas').get();

    const busquedas = snapshot.docs.map(doc => ({
      id: doc.id,
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
 * Actualiza campos de una búsqueda en Firestore: estado_busqueda, prioridad y criterios_screening.
 * Requiere header Authorization: Bearer <token_firebase>
 */
export const actualizarBusqueda = async (req, res) => {
  const { id } = req.params;
  const camposActualizar = req.body;

  if (!id) {
    return res.status(400).json({
      status: 'error',
      message: 'El parámetro id de búsqueda es obligatorio.'
    });
  }

  if (!camposActualizar || Object.keys(camposActualizar).length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'El body de la petición no puede estar vacío.'
    });
  }

  const payload = {};
  
  // 1. identificacion.hiring_manager
  if (camposActualizar.identificacion?.hiring_manager !== undefined) {
    payload['identificacion.hiring_manager'] = camposActualizar.identificacion.hiring_manager;
  } else if (camposActualizar.hiring_manager !== undefined) {
    payload['identificacion.hiring_manager'] = camposActualizar.hiring_manager;
  }

  // 2. perfil_tecnico.skills_excluyentes
  if (camposActualizar.perfil_tecnico?.skills_excluyentes !== undefined) {
    payload['perfil_tecnico.skills_excluyentes'] = camposActualizar.perfil_tecnico.skills_excluyentes;
  } else if (camposActualizar.skills_excluyentes !== undefined) {
    payload['perfil_tecnico.skills_excluyentes'] = camposActualizar.skills_excluyentes;
  }

  // 3. perfil_tecnico.skills_deseables
  if (camposActualizar.perfil_tecnico?.skills_deseables !== undefined) {
    payload['perfil_tecnico.skills_deseables'] = camposActualizar.perfil_tecnico.skills_deseables;
  } else if (camposActualizar.skills_deseables !== undefined) {
    payload['perfil_tecnico.skills_deseables'] = camposActualizar.skills_deseables;
  }

  // 4. perfil_tecnico.nivel_ingles_req
  if (camposActualizar.perfil_tecnico?.nivel_ingles_req !== undefined) {
    payload['perfil_tecnico.nivel_ingles_req'] = camposActualizar.perfil_tecnico.nivel_ingles_req;
  } else if (camposActualizar.nivel_ingles_req !== undefined) {
    payload['perfil_tecnico.nivel_ingles_req'] = camposActualizar.nivel_ingles_req;
  }

  // 5. condiciones.modalidad
  if (camposActualizar.condiciones?.modalidad !== undefined) {
    payload['condiciones.modalidad'] = camposActualizar.condiciones.modalidad;
  } else if (camposActualizar.modalidad !== undefined) {
    payload['condiciones.modalidad'] = camposActualizar.modalidad;
  }

  // 6. estado_sla.presupuesto_max
  if (camposActualizar.estado_sla?.presupuesto_max !== undefined) {
    payload['estado_sla.presupuesto_max'] = camposActualizar.estado_sla.presupuesto_max;
  } else if (camposActualizar.presupuesto_max !== undefined) {
    payload['estado_sla.presupuesto_max'] = camposActualizar.presupuesto_max;
  }

  // 7. estado_sla.link_job_description
  if (camposActualizar.estado_sla?.link_job_description !== undefined) {
    payload['estado_sla.link_job_description'] = camposActualizar.estado_sla.link_job_description;
  } else if (camposActualizar.link_job_description !== undefined) {
    payload['estado_sla.link_job_description'] = camposActualizar.link_job_description;
  }

  // 8. estado_sla.estado_busqueda
  if (camposActualizar.estado_sla?.estado_busqueda !== undefined) {
    payload['estado_sla.estado_busqueda'] = camposActualizar.estado_sla.estado_busqueda;
  } else if (camposActualizar.estado_busqueda !== undefined) {
    payload['estado_sla.estado_busqueda'] = camposActualizar.estado_busqueda;
  }

  // 9. estado_sla.prioridad
  if (camposActualizar.estado_sla?.prioridad !== undefined) {
    payload['estado_sla.prioridad'] = camposActualizar.estado_sla.prioridad;
  } else if (camposActualizar.prioridad !== undefined) {
    payload['estado_sla.prioridad'] = camposActualizar.prioridad;
  }

  // 10. criterios_screening (soporte raíz, camelCase y sub-bloques)
  const criteriosInput = 
    camposActualizar.criterios_screening !== undefined ? camposActualizar.criterios_screening :
    camposActualizar.criteriosScreening !== undefined ? camposActualizar.criteriosScreening :
    camposActualizar.criterios !== undefined ? camposActualizar.criterios :
    camposActualizar.estado_sla?.criterios_screening !== undefined ? camposActualizar.estado_sla.criterios_screening :
    camposActualizar.estado_sla?.criteriosScreening !== undefined ? camposActualizar.estado_sla.criteriosScreening :
    camposActualizar.perfil_tecnico?.criterios_screening !== undefined ? camposActualizar.perfil_tecnico.criterios_screening :
    camposActualizar.perfil_tecnico?.criteriosScreening !== undefined ? camposActualizar.perfil_tecnico.criteriosScreening :
    camposActualizar.identificacion?.criterios_screening !== undefined ? camposActualizar.identificacion.criterios_screening :
    undefined;

  if (criteriosInput !== undefined) {
    try {
      payload.criterios_screening = parseAndValidateCriteriosScreening(criteriosInput);
    } catch (err) {
      return res.status(400).json({
        status: 'error',
        message: err.message
      });
    }
  }

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'No hay campos válidos para actualizar.'
    });
  }

  payload.updatedAt = new Date().toISOString();

  try {
    const docRef = db.collection('busquedas').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({
        status: 'error',
        message: 'La búsqueda especificada no existe.'
      });
    }

    await docRef.update(payload);

    return res.status(200).json({
      status: 'success',
      message: 'Búsqueda actualizada exitosamente en Firestore.',
      id_busqueda: id,
      data: payload
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error al actualizar la búsqueda en Firestore.',
      detail: error.message
    });
  }
};
