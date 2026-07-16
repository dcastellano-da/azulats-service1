import { BigQuery } from '@google-cloud/bigquery';

// Blindaje Fail-Fast: si BIGQUERY_PROJECT_ID no está disponible en este momento,
// significa que dotenv no se cargó antes que este módulo — condición de carrera detectada.
if (!process.env.BIGQUERY_PROJECT_ID) {
  throw new Error(
    'BIGQUERY_PROJECT_ID no está definido en el entorno. ' +
    'Asegúrate de que import "dotenv/config" es la primera importación en index.js.'
  );
}

// Inicializa el cliente BigQuery forzando el proyecto analítico (Cross-Project)
export const bigquery = new BigQuery({
  projectId: process.env.BIGQUERY_PROJECT_ID
});
