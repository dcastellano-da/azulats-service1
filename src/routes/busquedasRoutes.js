import express from 'express';
import { crearBusqueda, obtenerBusquedas, actualizarBusqueda } from '../controllers/busquedasController.js';
import { verificarToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

// GET /  — Lista todas las búsquedas (Firestore). Requiere JWT válido.
router.get('/', verificarToken, obtenerBusquedas);

// POST / — Crea una nueva búsqueda con Dual Write. Requiere JWT válido.
router.post('/', verificarToken, crearBusqueda);

// PATCH /:id — Actualiza campos de una búsqueda con Dual Write. Requiere JWT válido.
router.patch('/:id', verificarToken, actualizarBusqueda);

export default router;
