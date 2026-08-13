process.env.NODE_ENV = 'test';

import { db } from '../src/config/firebase.js';
import { migrarBusquedasIds, esIdValido } from '../scripts/migrar-busquedas-ids.js';

async function runPruebaMigracion() {
  console.log('\n========================================');
  console.log('TEST: Prueba Automatizada de Migración de IDs de Búsquedas');
  console.log('========================================\n');

  // 1. Verificación unitaria de la función esIdValido
  console.log('🧪 1. Probando función esIdValido (Regex)...');

  const validos = [
    'aB1cD2eF3gH4iJ5kL6mN', // 20 alfanuméricos Firestore
    '1234567890abcdefghij', // 20 alfanuméricos
    'c4a938b8-4c12-4217-a068-967a57a58b29', // UUID v4 minúsculas
    'C4A938B8-4C12-4217-A068-967A57A58B29'  // UUID v4 mayúsculas
  ];

  const malformados = [
    'ANALISTA ADMINISTRATIVO', // Texto legible con espacio
    '11-',                     // Texto corto con guión
    'REQ-MOCK-001',            // Guión
    'DESARROLLADOR_SR',        // Guión bajo
    'shortId123',              // 11 chars
    'aB1cD2eF3gH4iJ5kL6mN!'    // 21 chars con símbolo
  ];

  for (const id of validos) {
    if (!esIdValido(id)) {
      console.error(`❌ ERROR: El ID "${id}" debería considerarse VÁLIDO pero fue rechazado.`);
      process.exit(1);
    }
  }
  console.log('  ✅ Todos los IDs válidos fueron reconocidos correctamente por la Regex.');

  for (const id of malformados) {
    if (esIdValido(id)) {
      console.error(`❌ ERROR: El ID malformado "${id}" fue clasificado erróneamente como VÁLIDO.`);
      process.exit(1);
    }
  }
  console.log('  ✅ Todos los IDs malformados fueron detectados correctamente.');

  // 2. Poblar Firestore en memoria con datos iniciales
  console.log('\n🧪 2. Poblando base de datos con documentos de prueba...');

  const collectionRef = db.collection('busquedas');

  // Documento malformado 1
  await collectionRef.doc('ANALISTA ADMINISTRATIVO').set({
    id_busqueda: 'ANALISTA ADMINISTRATIVO',
    identificacion: { cliente: 'Banco España' },
    perfil_tecnico: { rol_solicitado: 'Analista' }
  });

  // Documento malformado 2
  await collectionRef.doc('11-').set({
    id_busqueda: '11-',
    identificacion: { cliente: 'Empresa Demo' },
    perfil_tecnico: { rol_solicitado: 'Líder Técnico' }
  });

  // Documento válido 1 (Firestore 20 alfanumérico)
  const validId1 = 'aB1cD2eF3gH4iJ5kL6mN';
  await collectionRef.doc(validId1).set({
    id_busqueda: validId1,
    codigo_busqueda: 'REQ-001-VAL',
    identificacion: { cliente: 'Cliente Valido' }
  });

  // Documento válido 2 (UUID v4)
  const validId2 = 'c4a938b8-4c12-4217-a068-967a57a58b29';
  await collectionRef.doc(validId2).set({
    id_busqueda: validId2,
    codigo_busqueda: 'REQ-002-VAL',
    identificacion: { cliente: 'Cliente UUID' }
  });

  console.log('  ✅ Documentos cargados en la colección "busquedas" (2 malformados, 2 válidos).');

  // 3. Ejecutar migración
  console.log('\n🧪 3. Ejecutando migración...');
  const resultado = await migrarBusquedasIds();

  // 4. Aserciones de resultados
  console.log('🧪 4. Verificando resultados de la migración...');

  if (resultado.totalProcesados !== 4) {
    console.error(`❌ ERROR: Se esperaban 4 documentos procesados, pero se obtuvieron ${resultado.totalProcesados}`);
    process.exit(1);
  }

  if (resultado.migrados !== 2) {
    console.error(`❌ ERROR: Se esperaban 2 documentos migrados, pero fueron ${resultado.migrados}`);
    process.exit(1);
  }

  if (resultado.omitidos !== 2) {
    console.error(`❌ ERROR: Se esperaban 2 documentos omitidos, pero fueron ${resultado.omitidos}`);
    process.exit(1);
  }

  // Verificar que los documentos malformados antiguos fueron eliminados
  const docOld1 = await db.collection('busquedas').doc('ANALISTA ADMINISTRATIVO').get();
  const docOld2 = await db.collection('busquedas').doc('11-').get();

  if (docOld1.exists || docOld2.exists) {
    console.error('❌ ERROR: Los documentos originales con IDs malformados no fueron eliminados.');
    process.exit(1);
  }
  console.log('  ✅ Confirmado: Los documentos antiguos con IDs malformados fueron eliminados.');

  // Verificar que los documentos válidos se conservan
  const docVal1 = await db.collection('busquedas').doc(validId1).get();
  const docVal2 = await db.collection('busquedas').doc(validId2).get();

  if (!docVal1.exists || !docVal2.exists) {
    console.error('❌ ERROR: Los documentos válidos originales fueron eliminados o modificados erróneamente.');
    process.exit(1);
  }
  console.log('  ✅ Confirmado: Los documentos con IDs válidos se preservaron intactos.');

  // Verificar que los nuevos documentos migrados contienen el codigo_busqueda e id_busqueda actualizados
  const snapshotFinal = await db.collection('busquedas').get();
  const busquedasFinales = snapshotFinal.docs.map(d => d.data());

  const migradoAnalista = busquedasFinales.find(b => b.codigo_busqueda === 'ANALISTA ADMINISTRATIVO');
  const migrado11 = busquedasFinales.find(b => b.codigo_busqueda === '11-');

  if (!migradoAnalista || !esIdValido(migradoAnalista.id_busqueda)) {
    console.error('❌ ERROR: El documento migrado de "ANALISTA ADMINISTRATIVO" no posee un id_busqueda autogenerado válido. Detalle:', migradoAnalista);
    process.exit(1);
  }

  if (!migrado11 || !esIdValido(migrado11.id_busqueda)) {
    console.error('❌ ERROR: El documento migrado de "11-" no posee un id_busqueda autogenerado válido.');
    process.exit(1);
  }

  console.log(`  ✅ Confirmado: "ANALISTA ADMINISTRATIVO" migrado a nuevo ID "${migradoAnalista.id_busqueda}" con codigo_busqueda="${migradoAnalista.codigo_busqueda}"`);
  console.log(`  ✅ Confirmado: "11-" migrado a nuevo ID "${migrado11.id_busqueda}" con codigo_busqueda="${migrado11.codigo_busqueda}"`);

  console.log('\n========================================');
  console.log('✅ TODAS LAS PRUEBAS DE MIGRACIÓN PASARON EXITOSAMENTE');
  console.log('========================================\n');
}

runPruebaMigracion();
