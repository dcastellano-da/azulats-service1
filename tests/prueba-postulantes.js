import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 8080;
const BASE_URL = `http://localhost:${PORT}/api/v1/candidatos`;

// Asegurar archivos locales de prueba en la subcarpeta tests
const samplePdf = 'tests/sample-cv.pdf';
const sampleJpg = 'tests/sample-image.jpg';

if (!fs.existsSync('tests')) {
  fs.mkdirSync('tests');
}
if (!fs.existsSync(samplePdf)) {
  fs.writeFileSync(samplePdf, '%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/Resources << >>\n/MediaBox [0 0 612 792]\n>>\nendobj\nxref\n0 4\n0000000000 65535 f\n0000000015 00000 n\n0000000068 00000 n\n0000000120 00000 n\ntrailer\n<<\n/Size 4\n/Root 1 0 R\n>>\nstartxref\n210\n%%EOF');
}
if (!fs.existsSync(sampleJpg)) {
  fs.writeFileSync(sampleJpg, 'fake binary jpg image data');
}

async function runTestCase(name, formData, expectedStatus) {
  console.log(`\n========================================`);
  console.log(`TEST: ${name}`);
  console.log(`========================================`);
  try {
    const response = await fetch(BASE_URL, {
      method: 'POST',
      body: formData
    });

    const status = response.status;
    const body = await response.json();

    console.log(`Status devuelto: ${status} (Esperado: ${expectedStatus})`);
    console.log(`Cuerpo de respuesta:`, JSON.stringify(body, null, 2));

    if (status === expectedStatus) {
      console.log(`✅ RESULTADO: PASO COMPROBACION`);
    } else {
      console.error(`❌ RESULTADO: FALLO COMPROBACION`);
    }
  } catch (error) {
    console.error(`❌ Error al conectar con el servidor:`, error.message);
  }
}

async function start() {
  console.log('Iniciando batería de pruebas para Portal de Candidatos ATS...');

  // 1. Caso Exitoso
  const formSuccess = new FormData();
  const pdfBuffer = fs.readFileSync(samplePdf);
  formSuccess.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'candidato_cv.pdf');
  formSuccess.append('nombre_completo', 'Federico Soler');
  formSuccess.append('email', 'federico.soler@digitalagil.es');
  formSuccess.append('acepta_privacidad', 'true');
  formSuccess.append('puesto_postulacion', 'Chief Technology Officer');
  formSuccess.append('linkedin_url', 'https://linkedin.com/in/fedesoler');
  formSuccess.append('origen', 'landing_page');

  await runTestCase('Registro de Candidato Exitoso (PDF)', formSuccess, 201);

  // 2. Caso Validación Formato Inválido (JPG)
  const formBadFormat = new FormData();
  const jpgBuffer = fs.readFileSync(sampleJpg);
  formBadFormat.append('cv', new Blob([jpgBuffer], { type: 'image/jpeg' }), 'avatar.jpg');
  formBadFormat.append('nombre_completo', 'Lucas Gomez');
  formBadFormat.append('email', 'lucas@gmail.com');
  formBadFormat.append('acepta_privacidad', 'true');

  await runTestCase('Archivo con formato no permitido (JPG)', formBadFormat, 400);

  // 3. Caso Sin Privacidad (Regla de Trazabilidad Legal)
  const formNoPrivacy = new FormData();
  formNoPrivacy.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'candidato_cv.pdf');
  formNoPrivacy.append('nombre_completo', 'Lucas Gomez');
  formNoPrivacy.append('email', 'lucas@gmail.com');
  formNoPrivacy.append('acepta_privacidad', 'false');

  await runTestCase('Falta de aceptación de privacidad (acepta_privacidad=false)', formNoPrivacy, 400);

  // 4. Caso Sin Campos Obligatorios
  const formMissingFields = new FormData();
  formMissingFields.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'candidato_cv.pdf');
  formMissingFields.append('email', 'lucas@gmail.com');
  formMissingFields.append('acepta_privacidad', 'true');

  await runTestCase('Parámetros requeridos omitidos (nombre_completo)', formMissingFields, 400);
}

start();
