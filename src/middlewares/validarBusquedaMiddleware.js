import { z } from 'zod';

const criteriosFlexibleSchema = z.union([z.array(z.any()), z.string(), z.null()]).optional();

/**
 * Esquema Zod para la actualización parcial (PATCH) de Búsquedas.
 * Aplica .strip() en todos los niveles para ignorar propiedades no definidas en el esquema.
 */
export const patchBusquedaSchema = z.object({
  // Campos planos (raíz)
  estado_busqueda: z.string().optional(),
  prioridad: z.string().optional(),
  criterios_screening: criteriosFlexibleSchema,
  criteriosScreening: criteriosFlexibleSchema,
  criterios: criteriosFlexibleSchema,

  hiring_manager: z.string().nullable().optional(),
  skills_excluyentes: z.array(z.string()).optional(),
  skills_deseables: z.array(z.string()).optional(),
  nivel_ingles_req: z.string().nullable().optional(),
  modalidad: z.string().nullable().optional(),
  presupuesto_max: z.string().nullable().optional(),
  link_job_description: z.string().nullable().optional(),

  // Sub-bloques anidados
  identificacion: z.object({
    hiring_manager: z.string().nullable().optional(),
    criterios_screening: criteriosFlexibleSchema,
    criteriosScreening: criteriosFlexibleSchema
  }).strip().optional(),

  perfil_tecnico: z.object({
    skills_excluyentes: z.array(z.string()).optional(),
    skills_deseables: z.array(z.string()).optional(),
    nivel_ingles_req: z.string().nullable().optional(),
    criterios_screening: criteriosFlexibleSchema,
    criteriosScreening: criteriosFlexibleSchema
  }).strip().optional(),

  condiciones: z.object({
    modalidad: z.string().nullable().optional()
  }).strip().optional(),

  estado_sla: z.object({
    presupuesto_max: z.string().nullable().optional(),
    estado_busqueda: z.string().optional(),
    prioridad: z.string().optional(),
    link_job_description: z.string().nullable().optional(),
    criterios_screening: criteriosFlexibleSchema,
    criteriosScreening: criteriosFlexibleSchema,
    criterios: criteriosFlexibleSchema
  }).strip().optional()
}).strip();

/**
 * Middleware de validación para PATCH /api/v1/busquedas/:id
 * Valida y descarte (strip) propiedades no reconocidas antes de ceder el control al controlador.
 */
export const validarPatchBusqueda = (req, res, next) => {
  const result = patchBusquedaSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      status: 'error',
      message: 'Error de validación en el payload.',
      errors: result.error.errors
    });
  }
  // Reemplazar req.body por el objeto saneado (stripped) por Zod
  req.body = result.data;
  next();
};
