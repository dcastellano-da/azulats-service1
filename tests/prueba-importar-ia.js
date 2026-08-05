import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 8080;
const BASE_URL = `http://localhost:${PORT}/api/v1/candidatos/importar-ia`;

const samplePdf = 'tests/sample-cv.pdf';
const sampleJpg = 'tests/sample-image.jpg';

async function runTestCase(name, options, expectedStatus) {
  console.log(`\n========================================`);
  console.log(`TEST AI IMPORT: ${name}`);
  console.log(`========================================`);
  try {
    const response = await fetch(options.url || BASE_URL, {
      method: options.method || 'POST',
      headers: options.headers || {},
      body: options.body
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
  console.log('Iniciando batería de pruebas para Endpoint Importar IA B2B...');

  if (!fs.existsSync(samplePdf)) {
    console.error(`Archivo de muestra PDF no encontrado en ${samplePdf}`);
    process.exit(1);
  }
  if (!fs.existsSync(sampleJpg)) {
    console.error(`Archivo de muestra JPG no encontrado en ${sampleJpg}`);
    process.exit(1);
  }

  const pdfBuffer = fs.readFileSync(samplePdf);
  const jpgBuffer = fs.readFileSync(sampleJpg);

  // 1. Caso Sin Token de Sesión B2B -> Espera 401
  const formNoToken = new FormData();
  formNoToken.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'cv_ia.pdf');
  await runTestCase('1. Llamada sin token de autorización (Falla 401)', {
    body: formNoToken
  }, 401);

  // 2. Caso con Token Inválido -> Espera 403
  const formBadToken = new FormData();
  formBadToken.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'cv_ia.pdf');
  await runTestCase('2. Llamada con token inválido/expirado (Falla 403)', {
    headers: { 'Authorization': 'Bearer invalido-token-123' },
    body: formBadToken
  }, 403);

  // 3. Caso con Token de Reclutador pero Formato Inválido (JPG) -> Espera 400
  const formBadFormat = new FormData();
  formBadFormat.append('cv', new Blob([jpgBuffer], { type: 'image/jpeg' }), 'avatar.jpg');
  await runTestCase('3. Archivo con extensión/tipo incorrecto (JPG) (Falla 400)', {
    headers: { 'Authorization': 'Bearer mock-token-recruiter' },
    body: formBadFormat
  }, 400);

  // 4. Caso Exitoso con Token de Reclutador y PDF -> Espera 201
  const formSuccess = new FormData();
  formSuccess.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'curriculum_vitar_ia.pdf');
  const successResult = await runTestCase('4. Importación exitosa de Candidato usando IA (Pasa 201)', {
    headers: { 'Authorization': 'Bearer mock-token-recruiter' },
    body: formSuccess
  }, 201);

  if (successResult.success) {
    const data = successResult.body.data;
    console.log('\n🌟 Verificando estructura de datos retornada tras extracción:');
    console.log(`- ID Generado: ${data.id}`);
    console.log(`- Nombre Completo: ${data.nombre_completo}`);
    console.log(`- Email: ${data.email}`);
    console.log(`- Origen: ${data.origen} (Esperado: importacion_ia)`);
    console.log(`- URL CV: ${data.url_cv}`);
    console.log(`- Requisitos RGPD Aceptados: ${data.acepta_privacidad}`);
    console.log(`- Skills Principales: ${data.skills_principales}`);
    console.log(`- Notas Iniciales: ${data.notas_iniciales}`);
    console.log(`- Resumen: ${data.resumen}`);
    console.log(`- Rubros: ${data.rubros}`);
    console.log(`- Canal de Ingreso: ${data.canal_ingreso}`);
  }

  console.log('\n========================================');
  console.log('Batería de pruebas de importación IA finalizada.');
  console.log('========================================');
}

start();
