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

async function runTestCase(name, options, expectedStatus) {
  console.log(`\n========================================`);
  console.log(`TEST: ${name}`);
  console.log(`========================================`);
  try {
    const response = await fetch(options.url || BASE_URL, {
      method: options.method || 'GET',
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
  console.log('Iniciando batería de pruebas para Módulo Postulantes (Nuevos Requerimientos)...');

  const pdfBuffer = fs.readFileSync(samplePdf);

  // 1. Caso Exitoso (POST) con todos los nuevos 6 campos completos
  const formSuccess = new FormData();
  formSuccess.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'candidato_cv.pdf');
  formSuccess.append('nombre_completo', 'Federico Soler');
  formSuccess.append('email', 'federico.soler@digitalagil.es');
  formSuccess.append('acepta_privacidad', 'true');
  formSuccess.append('puesto_postulacion', 'Chief Technology Officer');
  formSuccess.append('linkedin_url', 'https://linkedin.com/in/fedesoler');
  formSuccess.append('origen', 'landing_page');
  
  // Nuevos campos
  formSuccess.append('telefono_movil', '+5491122334455');
  formSuccess.append('ubicacion', 'Buenos Aires, Argentina');
  formSuccess.append('skills_principales', 'Node.js, React, GCP, Express');
  formSuccess.append('nivel_ingles', 'C1 Advanced');
  formSuccess.append('otros_idiomas', 'Portugués (Básico)');
  formSuccess.append('notas_iniciales', 'Excelente perfil técnico con experiencia en Cloud');
  formSuccess.append('resumen', 'Ingeniero de Software Senior con background en Fintech y telecomunicaciones.');
  formSuccess.append('rubros', 'Finanzas, Telecomunicaciones, E-commerce');
  formSuccess.append('canal_ingreso', 'LinkedIn');

  const postResult = await runTestCase('Registro de Candidato Exitoso (Todos los campos nuevos y válidos)', {
    method: 'POST',
    body: formSuccess
  }, 201);

  let candidatoId = null;
  if (postResult.success && postResult.body && postResult.body.data) {
    candidatoId = postResult.body.data.id;
    console.log(`UUID del candidato capturado para pruebas posteriores: ${candidatoId}`);
  }

  // 1b. Caso Exitoso (POST) con campos nuevos vacíos o nulos
  const formEmptyNewFields = new FormData();
  formEmptyNewFields.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'candidato_cv.pdf');
  formEmptyNewFields.append('nombre_completo', 'Prueba Vacíos');
  formEmptyNewFields.append('email', 'pruebavacios@digitalagil.es');
  formEmptyNewFields.append('acepta_privacidad', 'true');
  formEmptyNewFields.append('telefono_movil', '');
  formEmptyNewFields.append('ubicacion', 'null');
  formEmptyNewFields.append('skills_principales', ''); // vacío no se valida
  formEmptyNewFields.append('nivel_ingles', 'null');

  await runTestCase('Registro de Candidato Exitoso con nuevos campos vacíos/nulos', {
    method: 'POST',
    body: formEmptyNewFields
  }, 201);

  // 1c. Caso Fallido por menos de 3 skills
  const formTooFewSkills = new FormData();
  formTooFewSkills.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'candidato_cv.pdf');
  formTooFewSkills.append('nombre_completo', 'Fallo Skills Min');
  formTooFewSkills.append('email', 'falloskillsmin@digitalagil.es');
  formTooFewSkills.append('acepta_privacidad', 'true');
  formTooFewSkills.append('skills_principales', 'Node.js, React'); // Solo 2

  await runTestCase('Falla al enviar menos de 3 skills_principales (2)', {
    method: 'POST',
    body: formTooFewSkills
  }, 400);

  // 1d. Caso Fallido por más de 5 skills
  const formTooManySkills = new FormData();
  formTooManySkills.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'candidato_cv.pdf');
  formTooManySkills.append('nombre_completo', 'Fallo Skills Max');
  formTooManySkills.append('email', 'falloskillsmax@digitalagil.es');
  formTooManySkills.append('acepta_privacidad', 'true');
  formTooManySkills.append('skills_principales', 'Node.js, React, GCP, Docker, Kubernetes, Git'); // 6

  await runTestCase('Falla al enviar más de 5 skills_principales (6)', {
    method: 'POST',
    body: formTooManySkills
  }, 400);

  // 2. Caso Validación Formato Inválido (JPG)
  const formBadFormat = new FormData();
  const jpgBuffer = fs.readFileSync(sampleJpg);
  formBadFormat.append('cv', new Blob([jpgBuffer], { type: 'image/jpeg' }), 'avatar.jpg');
  formBadFormat.append('nombre_completo', 'Lucas Gomez');
  formBadFormat.append('email', 'lucas@gmail.com');
  formBadFormat.append('acepta_privacidad', 'true');

  await runTestCase('Archivo con formato no permitido (JPG)', {
    method: 'POST',
    body: formBadFormat
  }, 400);

  // 3. Caso Sin Privacidad (Regla de Trazabilidad Legal)
  const formNoPrivacy = new FormData();
  formNoPrivacy.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'candidato_cv.pdf');
  formNoPrivacy.append('nombre_completo', 'Lucas Gomez');
  formNoPrivacy.append('email', 'lucas@gmail.com');
  formNoPrivacy.append('acepta_privacidad', 'false');

  await runTestCase('Falta de aceptación de privacidad (acepta_privacidad=false)', {
    method: 'POST',
    body: formNoPrivacy
  }, 400);

  // 4. Caso Sin Campos Obligatorios
  const formMissingFields = new FormData();
  formMissingFields.append('cv', new Blob([pdfBuffer], { type: 'application/pdf' }), 'candidato_cv.pdf');
  formMissingFields.append('email', 'lucas@gmail.com');
  formMissingFields.append('acepta_privacidad', 'true');

  await runTestCase('Parámetros requeridos omitidos (nombre_completo)', {
    method: 'POST',
    body: formMissingFields
  }, 400);

  // --- PRUEBAS ADMINISTRATIVAS (B2B) ---

  // 5. GET / sin token → Espera 401
  await runTestCase('GET / (Read) sin token de sesión', {
    method: 'GET',
    url: BASE_URL
  }, 401);

  // 6. GET / con token inválido o expirado → Espera 403
  await runTestCase('GET / (Read) con token inválido', {
    method: 'GET',
    url: BASE_URL,
    headers: {
      'Authorization': 'Bearer token-invalido-o-expirado'
    }
  }, 403);

  // 7. GET / con token de reclutador simulado → Espera 200
  await runTestCase('GET / (Read) exitoso con token reclutador', {
    method: 'GET',
    url: BASE_URL,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter'
    }
  }, 200);

  // 8. GET / con filtro por estado_revision=pendiente → Espera 200
  await runTestCase('GET / (Read Filtered) por estado_revision=pendiente', {
    method: 'GET',
    url: `${BASE_URL}?estado_revision=pendiente`,
    headers: {
      'Authorization': 'Bearer mock-token-recruiter'
    }
  }, 200);

  if (candidatoId) {
    // 9. PATCH /:id exitoso (modifica estado_revision y nombre, y nuevos campos) → Espera 200
    await runTestCase('PATCH /:id (Update) exitoso de campos permitidos y nuevos campos', {
      method: 'PATCH',
      url: `${BASE_URL}/${candidatoId}`,
      headers: {
        'Authorization': 'Bearer mock-token-recruiter',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        nombre_completo: 'Federico Soler Modificado',
        estado_revision: 'Revisado',
        telefono_movil: '+5491199998888',
        ubicacion: 'Madrid, España',
        skills_principales: 'Svelte, Vue.js, Node.js',
        nivel_ingles: 'B2 Upper Intermediate',
        otros_idiomas: 'Italiano',
        notas_iniciales: 'Añadidos comentarios tras entrevista telefónica.',
        resumen: 'Perfil modificado con experiencia adicional en Cloud.',
        rubros: 'Finanzas, Minería, Automotriz',
        canal_ingreso: 'Referido',
        puesto_postulacion: 'VP of Engineering'
      })
    }, 200);

    // 9b. PATCH /:id exitoso para borrar optional fields (vaciar/anular) → Espera 200
    await runTestCase('PATCH /:id (Update) permitiendo vaciar/anular campos opcionales', {
      method: 'PATCH',
      url: `${BASE_URL}/${candidatoId}`,
      headers: {
        'Authorization': 'Bearer mock-token-recruiter',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        telefono_movil: '',
        ubicacion: 'null',
        skills_principales: '',
        otros_idiomas: null,
        resumen: '',
        rubros: 'null'
      })
    }, 200);

    // 9c. PATCH /:id fallido por skills_principales fuera de rango menor en PATCH
    await runTestCase('PATCH /:id (Update) fallando por menos de 3 skills_principales', {
      method: 'PATCH',
      url: `${BASE_URL}/${candidatoId}`,
      headers: {
        'Authorization': 'Bearer mock-token-recruiter',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        skills_principales: 'Python, Django' // Solo 2
      })
    }, 400);

    // 9d. PATCH /:id fallido por skills_principales fuera de rango mayor en PATCH
    await runTestCase('PATCH /:id (Update) fallando por más de 5 skills_principales', {
      method: 'PATCH',
      url: `${BASE_URL}/${candidatoId}`,
      headers: {
        'Authorization': 'Bearer mock-token-recruiter',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        skills_principales: 'CSS, HTML, JS, TS, Node, Git' // 6
      })
    }, 400);

    // 10. PATCH /:id caso negativo (intento de inyección de acepta_privacidad) → Espera 400
    await runTestCase('PATCH /:id (Update) inyectando acepta_privacidad (inmutable)', {
      method: 'PATCH',
      url: `${BASE_URL}/${candidatoId}`,
      headers: {
        'Authorization': 'Bearer mock-token-recruiter',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        acepta_privacidad: false
      })
    }, 400);

    // 11. PATCH /:id caso negativo (intento de inyección de url_cv) → Espera 400
    await runTestCase('PATCH /:id (Update) inyectando url_cv (inmutable)', {
      method: 'PATCH',
      url: `${BASE_URL}/${candidatoId}`,
      headers: {
        'Authorization': 'Bearer mock-token-recruiter',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url_cv: 'gs://proyecto-hack/cvs/cv_malicioso.pdf'
      })
    }, 400);

    // 12. PATCH /:id sin token de autorización → Espera 401
    await runTestCase('PATCH /:id (Update) sin token de autorización', {
      method: 'PATCH',
      url: `${BASE_URL}/${candidatoId}`,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        estado_revision: 'Seleccionado'
      })
    }, 401);

    // 13. PATCH /:id descarte operativo (Soft Delete / Descarte) → Espera 200
    await runTestCase('PATCH /:id (Soft Delete / Descarte) para cambiar estado a Descartado', {
      method: 'PATCH',
      url: `${BASE_URL}/${candidatoId}`,
      headers: {
        'Authorization': 'Bearer mock-token-recruiter',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        estado_revision: 'Descartado'
      })
    }, 200);
  } else {
    console.error('⚠️ ATENCION: Omitiendo pruebas PATCH ya que no se pudo registrar un candidato inicial con ID.');
  }

  console.log('\n========================================');
  console.log('Batería de pruebas finalizada.');
  console.log('========================================');
}

start();
