import 'dotenv/config';
import { db } from '../src/config/firebase.js';

/**
 * Valida si un ID cumple con el formato estándar autogenerado de Firestore
 * (20 caracteres alfanuméricos) o UUID v4.
 *
 * @param {string} id ID del documento a verificar
 * @returns {boolean} True si el ID es autogenerado válido, false de lo contrario.
 */
export function esIdValido(id) {
  if (!id || typeof id !== 'string') return false;
  const regexFirestore = /^[a-zA-Z0-9]{20}$/;
  const regexUUIDv4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return regexFirestore.test(id) || regexUUIDv4.test(id);
}

/**
 * Recorre la colección 'busquedas' en Firestore, migrando los documentos cuyo ID
 * no sea autogenerado limpio a un nuevo documento con ID autogenerado.
 *
 * @returns {Promise<{ totalProcesados: number, migrados: number, omitidos: number, detalles: Array }>}
 */
export async function migrarBusquedasIds() {
  console.log('🚀 [MIGRACIÓN] Iniciando escaneo de la colección "busquedas"...');

  const collectionRef = db.collection('busquedas');
  const snapshot = await collectionRef.get();

  let migrados = 0;
  let omitidos = 0;
  const totalProcesados = snapshot.docs.length;
  const detalles = [];

  console.log(`📊 Encontrados ${totalProcesados} documentos en la colección.`);

  for (const doc of snapshot.docs) {
    const oldId = doc.id;
    const data = doc.data() || {};

    if (esIdValido(oldId)) {
      console.log(`ℹ️ [OMITIDO] El documento "${oldId}" tiene un ID autogenerado válido.`);
      omitidos++;
      continue;
    }

    console.log(`⚠️ [MALFORMADO] El documento "${oldId}" no cumple con el formato de ID autogenerado. Iniciando migración...`);

    // 1. Asignar el ID malformado antiguo al nuevo campo 'codigo_busqueda' si no existe previamente
    const codigoBusqueda = data.codigo_busqueda || oldId;
    delete data.id;

    // 2. Crear nueva referencia con un ID autogenerado limpio por Firebase
    const newDocRef = collectionRef.doc();
    const newId = newDocRef.id;

    // 3. Preparar los datos del nuevo documento
    const nuevoDocumento = {
      ...data,
      id_busqueda: newId,
      codigo_busqueda: codigoBusqueda,
      migradoAt: new Date().toISOString(),
      idOriginalMigrado: oldId
    };

    // 4. Escribir el nuevo documento y eliminar el antiguo
    await newDocRef.set(nuevoDocumento);
    const oldDocRef = collectionRef.doc(oldId);
    await oldDocRef.delete();

    migrados++;
    detalles.push({ oldId, newId, codigoBusqueda });
    console.log(`✅ [MIGRADO ÉXITO] ID antiguo: "${oldId}" ➡️ Nuevo ID: "${newId}" | codigo_busqueda: "${codigoBusqueda}"`);
  }

  console.log('\n========================================');
  console.log('🎉 [MIGRACIÓN COMPLETADA]');
  console.log(`Total documentos inspeccionados: ${totalProcesados}`);
  console.log(`Documentos migrados con éxito: ${migrados}`);
  console.log(`Documentos omitidos (ya válidos): ${omitidos}`);
  console.log('========================================\n');

  return { totalProcesados, migrados, omitidos, detalles };
}

// Ejecución directa desde CLI si el script se llama directamente con node
if (process.argv[1] && process.argv[1].endsWith('migrar-busquedas-ids.js')) {
  migrarBusquedasIds()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Error durante la migración:', err);
      process.exit(1);
    });
}
