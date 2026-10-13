import { getSyllabus, normaliseSubject, normaliseClassLevel, availableSubjects, availableClassLevels } from './questions.ts';

const TYPES = ['fill_blank','multiple_choice','matching','true_false','short_answer','circle_correct','sequence','count_objects','word_problem','trace_write'];
const GRADE_TYPES = {
  Nursery: ['matching','circle_correct','count_objects','trace_write'],
  LKG: ['matching','circle_correct','count_objects','fill_blank','trace_write'],
  UKG: TYPES, 'Class 1': TYPES, 'Class 2': TYPES, 'Class 3': TYPES
};
const EXAMPLES = {
  English: ['rhyming words','sight words','phonics','opposites','position words'],
  Mathematics: ['counting','number names','measurement squares','story sums','patterns'],
  Bengali: ['বর্ণ পরিচয়','শব্দ গঠন','স্বরচিহ্ন','ছবির সঙ্গে মিল','সঠিক বর্ণ']
};
const text = v => typeof v === 'string' ? v.trim() : '';
const normalized = v => text(v).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase();
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

function schema(allowed, count) {
  return {
    type: 'OBJECT',
    properties: {
      questions: {
        type: 'ARRAY', minItems: count, maxItems: count,
        items: {
          type: 'OBJECT',
          properties: {
            type: { type: 'STRING', enum: allowed },
            instruction: { type: 'STRING' },
            question: { type: 'STRING' },
            options: { type: 'ARRAY', items: { type: 'STRING' } },
            answer: { type: 'STRING' },
            visual_text: { type: 'STRING' },
            writing_lines: { type: 'INTEGER' },
            concept: { type: 'STRING' }
          },
          required: ['type','instruction','question','options','answer','visual_text','writing_lines','concept']
        }
      }
    },
    required: ['questions']
  };
}

function validateItems(items, allowed, accepted, seen, target) {
  const reasons = {};
  const reject = reason => { reasons[reason] = (reasons[reason] || 0) + 1; };
  for (let item of items) {
    if (accepted.length >= target) break;
    if (!item || typeof item !== 'object' || !allowed.includes(item.type)) { reject('invalid_type'); continue; }
    const question = text(item.question);
    const answer = text(item.answer);
    if (!question || !answer) { reject('missing_question_or_answer'); continue; }
    const key = normalized(question); // Detect duplicates across different question types too.
    if (seen.has(key)) { reject('duplicate_question'); continue; }
    const options = Array.isArray(item.options)
      ? item.options.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 8)
      : [];
    if (['multiple_choice','circle_correct'].includes(item.type)) {
      if (![3,4].includes(options.length) || new Set(options.map(normalized)).size !== options.length) {
        reject('invalid_choice_options'); continue;
      }
      // Gemini may vary whitespace/case in the answer. Normalize safely.
      const matchingOption = options.find(option => normalized(option) === normalized(answer));
      if (!matchingOption) { reject('choice_answer_not_in_options'); continue; }
      item = { ...item, answer: matchingOption };
    }
    if (item.type === 'matching') {
      if (!options.length || options.some(option => !option.includes('=>'))) {
        reject('invalid_matching_pairs'); continue;
      }
    }
    seen.add(key);
    accepted.push({
      id: accepted.length + 1,
      type: item.type,
      instruction: text(item.instruction).slice(0, 220),
      question: question.slice(0, 600),
      options: options.map(option => option.slice(0, 160)),
      answer: text(item.answer).slice(0, 350),
      visual_text: text(item.visual_text).slice(0, 180),
      writing_lines: Number.isInteger(item.writing_lines) ? Math.max(0, Math.min(5, item.writing_lines)) : 1,
      concept: text(item.concept).slice(0, 100)
    });
  }
  return reasons;
}

async function callGemini(fetcher, env, model, system, prompt, allowed, count) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema(allowed, count),
      temperature: 0.3,
      maxOutputTokens: Math.min(8192, 1800 + count * 450)
    }
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(body)
      });
    } catch (error) {
      console.error('Worksheet Gemini network failure', String(error));
      return { error: response({ success: false, error: 'worksheet_upstream_network_error' }, 502) };
    }
    if (!res.ok) {
      let upstream = {};
      try { upstream = (await res.json()).error || {}; } catch {}
      console.error('Worksheet Gemini error', { status: res.status, code: upstream.status, message: upstream.message });
      // Retry only transient server errors. 429 is quota-related and should not cause more paid attempts.
      if ([500, 502, 503, 504].includes(res.status) && attempt === 0) continue;
      return { error: response({
        success: false, error: 'worksheet_upstream_error',
        upstream_status: res.status,
        upstream_code: text(upstream.status) || 'UPSTREAM_ERROR',
        model,
        upstream_message: text(upstream.message).slice(0, 500)
      }, 502) };
    }
    let payload;
    try { payload = await res.json(); }
    catch { return { error: response({ success: false, error: 'worksheet_invalid_upstream_response' }, 502) }; }
    const candidate = payload.candidates?.[0];
    const output = candidate?.content?.parts?.map(part => part.text || '').join('') || '';
    if (!output) return { error: response({
      success: false, error: 'worksheet_empty_model_output',
      finish_reason: candidate?.finishReason || null,
      block_reason: payload.promptFeedback?.blockReason || null
    }, 502) };
    try { return { data: JSON.parse(output) }; }
    catch {
      console.error('Worksheet JSON parse failed', { finish_reason: candidate?.finishReason, length: output.length });
      return { error: response({
        success: false, error: 'worksheet_invalid_model_json',
        finish_reason: candidate?.finishReason || null
      }, 502) };
    }
  }
  return { error: response({ success: false, error: 'worksheet_generation_unavailable' }, 502) };
}

export async function worksheetRoute(request, env, fetcher = fetch) {
  const path = new URL(request.url).pathname;
  if (path === '/v1/worksheets/config' && request.method === 'GET') {
    return response({ success: true, data: {
      classes: availableClassLevels(), subjects: availableSubjects(), question_types: TYPES,
      max_questions: 30, output: 'structured_json', rendering: 'client_print_pdf'
    } });
  }
  if (path !== '/v1/worksheets/generate') return response({ success: false, error: 'not_found' }, 404);
  if (request.method !== 'POST') return response({ success: false, error: 'method_not_allowed' }, 405);
  if (!request.headers.get('Content-Type')?.includes('application/json')) return response({ success: false, error: 'json_required' }, 415);
  if (Number(request.headers.get('Content-Length') || 0) > 8192) return response({ success: false, error: 'payload_too_large' }, 413);

  let input;
  try { input = await request.json(); }
  catch { return response({ success: false, error: 'invalid_json' }, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['class_level','subject','question_count','language','difficulty','topic','seed'].includes(key))) {
    return response({ success: false, error: 'invalid_fields' }, 400);
  }
  const grade = typeof input.class_level === 'string' ? normaliseClassLevel(input.class_level) : null;
  const subject = typeof input.subject === 'string' ? normaliseSubject(input.subject) : null;
  const count = input.question_count;
  if (!grade) return response({ success: false, error: 'invalid_class_level', supported: availableClassLevels() }, 400);
  if (!subject || !getSyllabus(subject, grade)) return response({ success: false, error: 'invalid_subject_for_class', supported: availableSubjects() }, 400);
  if (!Number.isInteger(count) || count < 1 || count > 30) return response({ success: false, error: 'question_count_must_be_1_to_30' }, 400);
  const language = input.language || (subject === 'Bengali' ? 'bn' : 'en');
  if (!['en','bn','hi'].includes(language)) return response({ success: false, error: 'invalid_language' }, 400);
  if (subject === 'Bengali' && language !== 'bn') return response({ success: false, error: 'bengali_requires_bn' }, 400);
  if (input.topic !== undefined && (typeof input.topic !== 'string' || input.topic.length > 80)) return response({ success: false, error: 'invalid_topic' }, 400);
  if (input.difficulty !== undefined && !['easy','medium','hard'].includes(input.difficulty)) return response({ success: false, error: 'invalid_difficulty' }, 400);
  if (!env.GEMINI_API_KEY) return response({ success: false, error: 'gemini_not_configured' }, 503);

  // Preserve existing TutorLimiter integration. Production deployments should require it.
  if (env.TUTOR_LIMITER) {
    try {
      const uid = request.headers.get('X-User-Id');
      if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return response({ success: false, error: 'user_id_required' }, 400);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid));
      const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const stub = env.TUTOR_LIMITER.get(env.TUTOR_LIMITER.idFromName(key));
      const res = await stub.fetch('https://limiter.internal/check?kind=chat');
      const quota = await res.json();
      if (!res.ok || !quota.allowed) return response({ success: false, error: 'rate_limit_exceeded' }, 429);
    } catch { return response({ success: false, error: 'limiter_unavailable' }, 503); }
  }

  const model = String(env.WORKSHEET_MODEL || 'gemini-3.5-flash-lite').trim().replace(/^models\//, '');
  if (!/^[A-Za-z0-9._-]+$/.test(model)) return response({ success: false, error: 'invalid_worksheet_model_config' }, 500);
  const allowed = GRADE_TYPES[grade];
  const syllabus = getSyllabus(subject, grade);
  const system = `You are a careful early-childhood worksheet designer. Return only valid JSON matching the supplied schema. All exercises must be age-appropriate, unambiguous, safe, answerable and printable. Do not use image URLs, HTML or markdown. Do not include personal information. Use only the permitted question types. For multiple_choice/circle_correct: give EXACTLY 3 or 4 distinct string options and set answer to one of those options VERBATIM. For matching: options must be strings formatted 'left => right' and answer must summarize the correct pairs. For other types use options: []. Provide a nonempty question and answer for EVERY item. Avoid duplicate questions. For count_objects, use simple printable Unicode symbols in visual_text and ensure the count equals the answer. Bengali questions must be natural Bengali. Keep text brief and suitable for A4 worksheets.`;
  const base = {
    grade, subject, language, difficulty: input.difficulty || 'easy', topic: input.topic || null,
    allowed_types: allowed, syllabus: syllabus.slice(0, 10000), reference_patterns: EXAMPLES[subject] || [],
    instruction: 'Generate varied exercises appropriate to this grade. Return exactly the requested number of unique questions. Every item requires type,instruction,question,options,answer,visual_text,writing_lines,concept. writing_lines must be 0 to 5.'
  };
  const accepted = [], seen = new Set();
  let reasons = {};
  const initial = await callGemini(fetcher, env, model, system, JSON.stringify({ ...base, question_count: count }), allowed, count);
  if (initial.error) return initial.error;
  const initialItems = Array.isArray(initial.data?.questions) ? initial.data.questions : [];
  reasons = validateItems(initialItems, allowed, accepted, seen, count);

  // One optional top-up call, only when necessary; never discard valid questions.
  // To keep costs predictable, do not loop or retry indefinitely.
  if (accepted.length < count) {
    const missing = count - accepted.length;
    console.warn('Worksheet needs top-up', { requested: count, generated: initialItems.length, accepted: accepted.length, missing, rejected_reasons: reasons });
    const repair = await callGemini(fetcher, env, model, system, JSON.stringify({
      ...base, question_count: missing,
      instruction: `Generate exactly ${missing} NEW questions. Follow the schema. Avoid questions similar to the existing ones.`,
      existing_questions: accepted.map(q => q.question)
    }), allowed, missing);
    if (repair.error) {
      // A top-up failure must not discard already validated exercises.
      console.warn('Worksheet top-up failed; returning available valid questions');
    } else {
      const repairItems = Array.isArray(repair.data?.questions) ? repair.data.questions : [];
      const moreReasons = validateItems(repairItems, allowed, accepted, seen, count);
      for (const [key, value] of Object.entries(moreReasons)) reasons[key] = (reasons[key] || 0) + value;
    }
  }
  if (accepted.length === 0) {
    console.error('Worksheet has no valid questions', { requested: count, rejected_reasons: reasons });
    return response({ success: false, error: 'worksheet_no_valid_questions',
      requested_questions: count, accepted_questions: 0,
      message: 'Gemini did not return any valid questions.' }, 502);
  }
  const partial = accepted.length < count;
  if (partial) console.warn('Returning partial worksheet', { requested: count, accepted: accepted.length, rejected_reasons: reasons });
  return response({
    success: true,
    partial,
    message: partial
      ? `Generated ${accepted.length} of ${count} requested questions.`
      : 'Worksheet generated successfully.',
    data: {
      worksheet_id: crypto.randomUUID(), title: 'KidzenAI Practice Worksheet',
      class_level: grade, subject, language,
      requested_questions: count,
      total_questions: accepted.length,
      print: { paper: 'A4', watermark: 'KidzenAI', fields: ['Name','Date','Class'], show_answers: false },
      questions: accepted.map(({ answer, ...q }) => q),
      answer_key: accepted.map(q => ({ id: q.id, answer: q.answer }))
    }
  });
}
