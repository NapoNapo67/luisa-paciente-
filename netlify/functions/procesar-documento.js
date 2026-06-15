const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { foto_url } = body;
  if (!foto_url) {
    return { statusCode: 400, body: JSON.stringify({ error: 'foto_url requerida' }) };
  }

  // Descargar la imagen para pasarla a Claude como base64
  let imageBase64, mediaType;
  try {
    const resp = await fetch(foto_url);
    if (!resp.ok) throw new Error('No se pudo descargar la imagen');
    const buffer = await resp.arrayBuffer();
    imageBase64 = Buffer.from(buffer).toString('base64');
    mediaType = resp.headers.get('content-type') || 'image/jpeg';
    // Claude solo acepta jpeg, png, gif, webp
    if (!['image/jpeg','image/png','image/gif','image/webp'].includes(mediaType)) {
      mediaType = 'image/jpeg';
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Error descargando imagen: ' + err.message }) };
  }

  const prompt = `Eres un asistente médico que extrae información estructurada de documentos de salud.

Analiza esta imagen y extrae TODA la información que puedas. Responde ÚNICAMENTE con un JSON válido con esta estructura exacta:

{
  "tipo_documento": "receta" | "estudio_laboratorio" | "imagen_diagnostica" | "indicaciones" | "otro",
  "titulo": "título corto descriptivo (máx 60 chars)",
  "resumen": "resumen en 1-2 oraciones para el paciente",
  "fecha": "fecha del documento si aparece, formato DD/MM/YYYY, o null",
  "medico": "nombre del médico si aparece, o null",
  "cedula": "cédula profesional si aparece, o null",
  "especialidad": "especialidad médica si aparece, o null",
  "institucion": "hospital o clínica si aparece, o null",
  "diagnostico": "diagnóstico o motivo de consulta si aparece, o null",
  "medicamentos": [
    {
      "nombre": "nombre del medicamento",
      "dosis": "dosis si aparece",
      "frecuencia": "frecuencia si aparece",
      "duracion": "duración si aparece"
    }
  ],
  "instrucciones": ["instrucción 1", "instrucción 2"],
  "alertas": ["alerta clínica importante 1", "alerta 2"],
  "proxima_cita": "fecha de próxima cita si aparece, o null"
}

Si algún campo no aplica o no aparece en el documento, usa null o array vacío [].
No incluyas texto fuera del JSON.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 }
            },
            { type: 'text', text: prompt }
          ]
        }
      ]
    });

    const texto = response.content[0].text.trim();

    // Extraer JSON aunque Claude agregue texto extra
    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude no devolvió JSON válido');

    const resultado = JSON.parse(match[0]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resultado)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error procesando con Claude: ' + err.message })
    };
  }
};
