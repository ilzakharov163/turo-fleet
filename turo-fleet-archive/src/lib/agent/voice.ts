// Голосовые → текст через OpenAI Whisper. Подсказка с терминами Turo, чтобы правильно писались Initial, Supplement, номера.

const PROMPT = 'Turo, клейм, Initial, Supplement, простой, листинг, Gross, расход, GPS, мойка, Nissan Altima, Toyota Camry, BMW X1, номер 527AKP1.'

export async function transcribe(bytes: Buffer, filename = 'voice.ogg'): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return null
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/ogg' }), filename)
  form.append('model', 'whisper-1')
  form.append('language', 'ru')
  form.append('prompt', PROMPT)
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form,
  })
  if (!res.ok) { console.error('whisper', res.status, await res.text().catch(() => '')); return null }
  const json = await res.json() as { text?: string }
  return json.text?.trim() || null
}
