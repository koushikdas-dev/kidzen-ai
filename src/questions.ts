// ======================================================
// KIDZENAI WORKER — GEMINI QUESTIONS + IMAGE PROMPTS ONLY
//
// Single-file Cloudflare Worker.
// The syllabus lives at the BOTTOM of this file.
//
// Gemini creates every question plus the image prompt(s) that
// a separate image service can use later. THIS WORKER DOES NOT
// GENERATE, STORE OR SERVE IMAGES.
//
// Every question is visual and uses ONE of three layouts:
//
//   1. image_question_text_options
//        question picture prompt + four word options
//
//   2. text_question_image_options
//        text question + four option-picture prompts
//
//   3. image_question_image_options
//        question picture prompt + four option-picture prompts
//
// Duplicate protection is multi-layered:
//   - exact normalized wording
//   - near-duplicate wording similarity
//   - duplicate option sets
//   - semantic concept_key
//   - generalized question_type / reasoning pattern
//
// SETUP:
//   wrangler secret put GEMINI_API_KEY
// ======================================================


interface Env {
  GEMINI_API_KEY: string;
}

interface GenerateTestRequest {
  class_level: string;
  subject?: string;
  subjects?: string[];
  difficulty: string;
  question_count: number;
}


// Layout the MODEL is asked to choose from.
type ModelLayout =
  | "IMAGE_QUESTION_TEXT_OPTIONS"
  | "IMAGE_OPTIONS_ONLY"
  | "IMAGE_QUESTION_AND_IMAGE_OPTIONS";


// Layout the APP receives. No image URLs are produced here.
type QuestionLayout =
  | "image_question_text_options"
  | "text_question_image_options"
  | "image_question_image_options";


interface ModelQuestion {
  question: string;

  // Same learning target => same conceptKey.
  // Example: comparing which group has more objects.
  conceptKey: string;

  // Same reasoning mechanic => same questionType even when
  // nouns, names, numbers or wording are changed.
  // Example: COUNT_VISIBLE_OBJECTS.
  questionType: string;

  options: string[];
  answer: string;
  layout: ModelLayout;
  imagePrompt: string;
  optionImagePrompts?: string[];
  explanation?: string;
}


interface Question {
  id: number;
  subject: string;
  class_level: string;
  question: string;

  // Returned intentionally so your DB/season layer can persist
  // them and prevent semantic duplicates across future runs.
  concept_key: string;
  question_type: string;

  options: string[];
  answer: string;
  correct_answer: number;
  explanation: string;

  layout: QuestionLayout;

  // Prompt metadata only — no image is generated here.
  image_required: boolean;
  image_prompt: string;
  option_images_required: boolean;
  option_image_prompts: string[];
}


// ------------------------------------------------------
// GEMINI CONFIG  (text only)
// ------------------------------------------------------

const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";


// Text model (structured JSON output).
const TEXT_MODEL = "gemini-3.1-flash-lite";


// 0 turns thinking off, which is much faster for this kind
// of templated generation. Raise to 1024 if quality drops.
const THINKING_BUDGET = 0;


// Set to false if you want the model to return ONLY
// the required fields with no explanation.
const INCLUDE_EXPLANATION = true;


// ------------------------------------------------------
// TEXT GENERATION RETRIES
// ------------------------------------------------------

// How many times text generation is retried on 503/API errors.
const TEXT_ATTEMPTS = 3;


// How many extra generation rounds we allow when the model
// returns fewer usable questions than requested.
const MAX_GENERATION_ROUNDS = 5;


// Roughly what share of questions should use both a question
// image prompt and option image prompts (the richest visual layout).
const BOTH_IMAGES_SHARE = 0.2;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};


// ======================================================
// WORKER
// ======================================================

export const questionWorker = {

  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    // -----------------------------------------------
    // CORS
    // -----------------------------------------------

    if (request.method === "OPTIONS") {

      return new Response(null, {
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);

    try {

      // -----------------------------------------------
      // HOME / HEALTH CHECK
      // -----------------------------------------------

      if (
        url.pathname === "/" &&
        request.method === "GET"
      ) {

        return json({
          status: true,
          message: "KidzenAI API is running",
          version: "6.0.0-gemini-text-gptimage2-visual"
        });
      }


      // -----------------------------------------------
      // SYLLABUS METADATA (useful for the app UI)
      // -----------------------------------------------

      if (
        url.pathname === "/syllabus" &&
        request.method === "GET"
      ) {

        const subject =
          url.searchParams.get("subject");

        const classLevel =
          url.searchParams.get("class_level");


        if (subject && classLevel) {

          const text =
            getSyllabus(subject, classLevel);

          if (!text) {

            return json(
              {
                status: false,
                message:
                  "No syllabus found for that subject and class"
              },
              404
            );
          }

          return json({
            status: true,
            data: {
              subject:
                normaliseSubject(subject),
              class_level:
                normaliseClassLevel(classLevel),
              syllabus: text
            }
          });
        }


        return json({
          status: true,
          data: {
            subjects: availableSubjects(),
            class_levels: availableClassLevels()
          }
        });
      }


      // -----------------------------------------------
      // GENERATE TEST
      // -----------------------------------------------

      if (url.pathname === "/generate-test") {

        if (request.method !== "POST") {

          return json(
            {
              status: false,
              message: "Only POST method is allowed"
            },
            405
          );
        }

        return await generateTest(request, env);
      }


      // -----------------------------------------------
      // ROUTE NOT FOUND
      // -----------------------------------------------

      return json(
        {
          status: false,
          message: "Route not found"
        },
        404
      );

    } catch (error) {

      console.error(error);

      return json(
        {
          status: false,
          message: "Internal server error",

          error:
            error instanceof Error
              ? error.message
              : String(error)
        },
        500
      );
    }
  }

} satisfies ExportedHandler<Env>;


// ======================================================
// GENERATE TEST
// ======================================================

async function generateTest(
  request: Request,
  env: Env
): Promise<Response> {

  const startedAt = Date.now();

  let body: GenerateTestRequest;

  try {
    body = await request.json() as GenerateTestRequest;
  } catch {
    return json(
      {
        status: false,
        message: "Invalid JSON body"
      },
      400
    );
  }


  // -----------------------------------------------
  // CLASS LEVEL
  // -----------------------------------------------

  if (!body.class_level) {
    return json(
      {
        status: false,
        message: "class_level is required"
      },
      400
    );
  }

  const classLevel =
    normaliseClassLevel(body.class_level);

  if (!classLevel) {
    return json(
      {
        status: false,
        message: `Unknown class_level "${body.class_level}"`,
        supported: availableClassLevels()
      },
      400
    );
  }


  // -----------------------------------------------
  // SUBJECTS
  // -----------------------------------------------

  const rawSubjects =
    Array.isArray(body.subjects) && body.subjects.length > 0
      ? body.subjects
      : body.subject
        ? [body.subject]
        : [];

  if (rawSubjects.length === 0) {
    return json(
      {
        status: false,
        message: "At least one subject is required"
      },
      400
    );
  }

  const subjects: string[] = [];

  for (const raw of rawSubjects) {
    const name = normaliseSubject(raw);

    if (!name) {
      return json(
        {
          status: false,
          message: `Unknown subject "${raw}"`,
          supported: availableSubjects()
        },
        400
      );
    }

    if (!subjects.includes(name)) {
      subjects.push(name);
    }
  }


  // -----------------------------------------------
  // QUESTION COUNT
  // -----------------------------------------------

  const questionCount = Number(body.question_count || 10);

  if (
    !Number.isFinite(questionCount) ||
    questionCount < 1 ||
    questionCount > 100
  ) {
    return json(
      {
        status: false,
        message: "question_count must be between 1 and 100"
      },
      400
    );
  }

  const difficulty =
    (body.difficulty || "Easy").trim();

  const plan =
    splitCount(questionCount, subjects.length);

  const testId =
    `test_${Date.now()}`;


  // -----------------------------------------------
  // GEMINI QUESTIONS + IMAGE PROMPTS ONLY
  // -----------------------------------------------

  const questions =
    await collectQuestions(
      {
        subjects,
        plan,
        classLevel,
        difficulty,
        targetCount: questionCount
      },
      env
    );

  if (questions.length < questionCount) {
    console.warn(
      `Only produced ${questions.length} of ${questionCount} requested questions ` +
      `after strict duplicate/type filtering`
    );
  }

  if (questions.length === 0) {
    return json(
      {
        status: false,
        message: "Question generation failed. Please try again."
      },
      502
    );
  }

  const layoutSummary =
    questions.reduce(
      (summary, question) => {
        summary[question.layout] =
          (summary[question.layout] ?? 0) + 1;
        return summary;
      },
      {} as Record<string, number>
    );

  console.log(
    `Test ${testId} ready — ` +
    `${questions.length} unique questions, ` +
    `${new Set(questions.map((q) => q.question_type)).size} unique question types, ` +
    `${new Set(questions.map((q) => q.concept_key)).size} unique concepts, ` +
    `prompt-only visuals, total ${Date.now() - startedAt}ms`
  );

  return json({
    status: true,
    message: "AI Test generated successfully",
    data: {
      test_id: testId,
      class_level: classLevel,
      subjects,
      difficulty,
      total_questions: questions.length,

      // Explicitly confirms this endpoint generated no images.
      image_generation_enabled: false,

      unique_question_types:
        new Set(questions.map((q) => q.question_type)).size,

      unique_concepts:
        new Set(questions.map((q) => q.concept_key)).size,

      layout_summary: layoutSummary,
      generation_ms: Date.now() - startedAt,
      questions
    }
  });
}


// ======================================================
// COLLECT UNIQUE QUESTIONS WITH STRICT TYPE DIVERSITY
//
// The model sometimes returns questions that fail
// validation (answer not matching an option, duplicate
// options, broken option image prompts) or that duplicate
// an earlier question. Those are dropped, so we over-request
// on every round and run top-up rounds for whatever is still
// missing, telling the model what it has already produced.
// ======================================================

async function collectQuestions(
  params: {
    subjects: string[];
    plan: number[];
    classLevel: string;
    difficulty: string;
    targetCount: number;
  },
  env: Env
): Promise<Question[]> {

  const {
    subjects,
    plan,
    classLevel,
    difficulty,
    targetCount
  } = params;

  const kept: Question[][] =
    subjects.map(() => []);


  // --------------------------------------------------
  // MULTI-LAYER DIVERSITY MEMORY FOR THIS TEST
  // --------------------------------------------------
  //
  // Exact text alone is not enough. These sets prevent:
  //   "How many apples?" / "Count the apples."
  //   "Count 4 stars" / "Count 7 balls"
  //   same options shuffled into another question
  //   same learning concept phrased differently
  // --------------------------------------------------

  const seenQuestionFingerprints = new Set<string>();
  const seenOptionSets = new Set<string>();
  const seenConceptKeys = new Set<string>();
  const seenQuestionTypes = new Set<string>();

  // Used for fuzzy wording comparison.
  const acceptedQuestionTexts: string[] = [];

  const quota = [...plan];


  for (
    let round = 0;
    round < MAX_GENERATION_ROUNDS;
    round++
  ) {

    const missing =
      subjects.map(
        (_, i) => quota[i] - kept[i].length
      );

    if (missing.every((m) => m <= 0)) {
      break;
    }


    // Last round: redistribute any remaining slots.
    if (round === MAX_GENERATION_ROUNDS - 1) {
      const currentTotal =
        kept.reduce((sum, bucket) => sum + bucket.length, 0);

      if (currentTotal < targetCount) {
        const extra =
          splitCount(
            targetCount - currentTotal,
            subjects.length
          );

        for (let i = 0; i < subjects.length; i++) {
          quota[i] += extra[i];
          missing[i] = quota[i] - kept[i].length;
        }
      }
    }


    const batches = await Promise.all(
      subjects.map(
        async (subject, index) => {

          const need = missing[index];

          if (need <= 0) {
            return [] as ModelQuestion[];
          }

          const syllabusText =
            getSyllabus(subject, classLevel);

          if (!syllabusText) {
            return [] as ModelQuestion[];
          }

          // Strict filtering can discard several candidates, so
          // deliberately request a larger pool for top-up rounds.
          const askFor =
            need + diversityBufferFor(need);

          try {
            return await generateQuestionsWithRetry(
              {
                subject,
                classLevel,
                difficulty,
                questionCount: askFor,
                layouts: layoutCounts(askFor),
                syllabusText,

                // Feed the full accepted-test history back to the model,
                // not only this subject's bucket. This reduces wasted
                // candidates on later top-up rounds.
                avoidQuestions:
                  [...acceptedQuestionTexts],

                avoidQuestionTypes:
                  [...seenQuestionTypes],

                avoidConceptKeys:
                  [...seenConceptKeys]
              },
              env
            );

          } catch (error) {
            console.error(
              `Question generation failed for ${subject} (round ${round + 1})`,
              error
            );

            return [] as ModelQuestion[];
          }
        }
      )
    );


    // --------------------------------------------------
    // NORMALISE + VALIDATE + INTELLIGENT DEDUPE
    // --------------------------------------------------

    batches.forEach((batch, index) => {
      const subject = subjects[index];

      for (const item of batch) {

        if (kept[index].length >= quota[index]) {
          break;
        }

        const normalised =
          normaliseQuestion(item, subject, classLevel, 0);

        if (!normalised) {
          continue;
        }

        const questionPrint =
          fingerprint(normalised.question);

        const optionPrint =
          optionSetFingerprint(normalised.options);

        const conceptPrint =
          canonicalKey(normalised.concept_key);

        const typePrint =
          canonicalKey(normalised.question_type);


        // 1) Exact/normalized same wording.
        if (seenQuestionFingerprints.has(questionPrint)) {
          console.log(`Dropped exact duplicate: ${normalised.question}`);
          continue;
        }

        // 2) Same four options, even when reordered.
        if (seenOptionSets.has(optionPrint)) {
          console.log(`Dropped repeated option set: ${normalised.question}`);
          continue;
        }

        // 3) Same semantic learning target.
        if (seenConceptKeys.has(conceptPrint)) {
          console.log(
            `Dropped repeated concept ${normalised.concept_key}: ${normalised.question}`
          );
          continue;
        }

        // 4) Same generalized reasoning/question pattern.
        // This is the main guard against:
        // "Count the apples" -> "Count the balls".
        if (seenQuestionTypes.has(typePrint)) {
          console.log(
            `Dropped repeated question type ${normalised.question_type}: ${normalised.question}`
          );
          continue;
        }

        // 5) Fuzzy wording similarity catches rephrases even if
        // the model accidentally emits a different metadata key.
        if (
          acceptedQuestionTexts.some(
            (previous) =>
              areQuestionsTooSimilar(previous, normalised.question)
          )
        ) {
          console.log(`Dropped near-duplicate: ${normalised.question}`);
          continue;
        }


        seenQuestionFingerprints.add(questionPrint);
        seenOptionSets.add(optionPrint);
        seenConceptKeys.add(conceptPrint);
        seenQuestionTypes.add(typePrint);
        acceptedQuestionTexts.push(normalised.question);

        kept[index].push(normalised);
      }
    });


    const total =
      kept.reduce((sum, bucket) => sum + bucket.length, 0);

    console.log(
      `Round ${round + 1}: ${total}/${targetCount} questions collected; ` +
      `${seenQuestionTypes.size} unique types, ${seenConceptKeys.size} unique concepts`
    );

    if (total >= targetCount) {
      break;
    }
  }


  const questions: Question[] = [];

  for (const bucket of kept) {
    for (const question of bucket) {
      questions.push(question);
    }
  }

  return spreadLayouts(questions.slice(0, targetCount))
    .map((question, index) => ({
      ...question,
      id: index + 1
    }));
}


// ======================================================
// SPREAD THE LAYOUTS OUT
//
// Even when the counts are right, the model tends to emit
// all the picture-option questions together. This shuffles
// them so a child gets variety as they play, without
// changing which questions are in the quiz.
// ======================================================

function spreadLayouts(questions: Question[]): Question[] {

  const buckets = new Map<QuestionLayout, Question[]>();

  for (const question of questions) {

    const bucket =
      buckets.get(question.layout) ?? [];

    bucket.push(question);

    buckets.set(question.layout, bucket);
  }


  const lists =
    [...buckets.values()]
      .sort((a, b) => b.length - a.length);


  const result: Question[] = [];

  let index = 0;

  while (result.length < questions.length) {

    for (const list of lists) {

      if (index < list.length) {
        result.push(list[index]);
      }
    }

    index++;
  }


  return result;
}


// ======================================================
// HOW MANY QUESTIONS OF EACH LAYOUT TO ASK FOR
//
// Roughly:  40% picture question + word options
//           40% word question + picture options
//           20% picture question + picture options
// ======================================================

function layoutCounts(count: number): {
  imageQuestion: number;
  imageOptions: number;
  both: number;
} {

  const both =
    count >= 5
      ? Math.max(1, Math.round(count * BOTH_IMAGES_SHARE))
      : 0;

  const rest =
    Math.max(0, count - both);

  const imageOptions =
    Math.round(rest / 2);

  const imageQuestion =
    rest - imageOptions;

  return {
    imageQuestion,
    imageOptions,
    both
  };
}


// ======================================================
// HOW MANY EXTRA QUESTIONS TO REQUEST
// ======================================================

function diversityBufferFor(count: number): number {

  // More generous than the old buffer because semantic/type
  // filtering intentionally rejects repetitive candidates.
  return Math.min(
    12,
    Math.max(4, Math.ceil(count * 0.75))
  );
}


// ======================================================
// DUPLICATE / DIVERSITY HELPERS
// ======================================================

function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function canonicalKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}


function optionSetFingerprint(options: string[]): string {
  // Sort so [cat,dog,cow,fish] and [dog,fish,cat,cow]
  // count as the same option set.
  return options
    .map((option) => fingerprint(option))
    .sort()
    .join("|");
}


function similarityTokens(text: string): Set<string> {
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were",
    "do", "does", "did", "can", "could", "will",
    "please", "look", "at", "picture", "image",
    "choose", "select", "pick", "find", "identify"
  ]);

  const normalized = text
    .toLowerCase()
    .replace(/\b\d+\b/g, " number ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return new Set(
    normalized
      .split(" ")
      .filter((token) => token.length > 1 && !stopWords.has(token))
  );
}


function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of a) {
    if (b.has(token)) {
      intersection++;
    }
  }

  const union = a.size + b.size - intersection;

  return union === 0 ? 0 : intersection / union;
}


function areQuestionsTooSimilar(a: string, b: string): boolean {
  const exactA = fingerprint(a);
  const exactB = fingerprint(b);

  if (exactA === exactB) {
    return true;
  }

  const tokensA = similarityTokens(a);
  const tokensB = similarityTokens(b);

  // Very short questions are handled primarily by question_type
  // and concept_key; fuzzy matching is safer with 3+ content tokens.
  if (tokensA.size < 3 || tokensB.size < 3) {
    return false;
  }

  return jaccardSimilarity(tokensA, tokensB) >= 0.72;
}


// ======================================================
// SPLIT A TOTAL COUNT EVENLY ACROSS N BUCKETS
// ======================================================

function splitCount(
  total: number,
  buckets: number
): number[] {

  const base =
    Math.floor(total / buckets);

  let remainder =
    total % buckets;


  const result: number[] = [];

  for (let i = 0; i < buckets; i++) {

    result.push(
      base + (remainder > 0 ? 1 : 0)
    );

    if (remainder > 0) {
      remainder--;
    }
  }

  return result;
}


// ======================================================
// NORMALISE ONE MODEL QUESTION
//
// The model returns the answer as a STRING that must
// exactly match one option. We convert that into a
// zero-based index for the app. Anything that fails
// validation is dropped rather than guessed, so a
// child is never shown a wrong "correct" answer.
//
// Picture prompts are validated hard: four option prompts
// must be present and distinct whenever the layout needs them.
// ======================================================

function normaliseQuestion(
  item: ModelQuestion,
  subject: string,
  classLevel: string,
  id: number
): Question | null {

  if (
    !item ||
    typeof item.question !== "string" ||
    !Array.isArray(item.options)
  ) {
    return null;
  }

  const question = item.question.trim();

  const conceptKey =
    typeof item.conceptKey === "string"
      ? canonicalKey(item.conceptKey)
      : "";

  const questionType =
    typeof item.questionType === "string"
      ? canonicalKey(item.questionType)
      : "";

  const options =
    item.options
      .filter((o) => typeof o === "string")
      .map((o) => o.trim());

  if (
    question.length === 0 ||
    conceptKey.length === 0 ||
    questionType.length === 0 ||
    options.length !== 4 ||
    options.some((o) => o.length === 0)
  ) {
    console.warn(`Dropped malformed question: ${question}`);
    return null;
  }


  // Duplicate options make the question ambiguous/unanswerable.
  const uniqueOptions =
    new Set(options.map((o) => fingerprint(o)));

  if (uniqueOptions.size !== 4) {
    console.warn(`Dropped question with duplicate options: ${question}`);
    return null;
  }

  const answer =
    typeof item.answer === "string"
      ? item.answer.trim()
      : "";

  let correctIndex =
    options.indexOf(answer);

  if (correctIndex === -1) {
    correctIndex =
      options.findIndex(
        (o) => o.toLowerCase() === answer.toLowerCase()
      );
  }

  if (correctIndex === -1) {
    console.warn(
      `Dropped question — answer "${answer}" does not match any option: ${question}`
    );
    return null;
  }


  // --------------------------------------------------
  // IMAGE PROMPTS — KEPT, BUT NO IMAGE IS GENERATED
  // --------------------------------------------------

  const imagePrompt =
    typeof item.imagePrompt === "string"
      ? item.imagePrompt.trim()
      : "";

  const optionImagePrompts =
    Array.isArray(item.optionImagePrompts)
      ? item.optionImagePrompts
          .filter((p) => typeof p === "string")
          .map((p) => p.trim())
      : [];

  const optionPromptsUsable =
    optionImagePrompts.length === 4 &&
    optionImagePrompts.every((p) => p.length > 0) &&
    new Set(
      optionImagePrompts.map((p) => fingerprint(p))
    ).size === 4;

  const declaredLayout =
    typeof item.layout === "string"
      ? item.layout.trim().toUpperCase()
      : "";

  let wantsQuestionImage: boolean;
  let wantsOptionImages: boolean;

  switch (declaredLayout) {
    case "IMAGE_OPTIONS_ONLY":
      wantsQuestionImage = false;
      wantsOptionImages = true;
      break;

    case "IMAGE_QUESTION_AND_IMAGE_OPTIONS":
      wantsQuestionImage = true;
      wantsOptionImages = true;
      break;

    case "IMAGE_QUESTION_TEXT_OPTIONS":
      wantsQuestionImage = true;
      wantsOptionImages = false;
      break;

    default:
      wantsQuestionImage = imagePrompt.length > 0;
      wantsOptionImages = optionPromptsUsable;
  }

  // Do not accept a declared visual layout with missing prompt data.
  // We keep prompts strict because a later service will generate images.
  if (wantsOptionImages && !optionPromptsUsable) {
    console.warn(`Dropped question with unusable option image prompts: ${question}`);
    return null;
  }

  if (wantsQuestionImage && imagePrompt.length === 0) {
    console.warn(`Dropped question with missing question image prompt: ${question}`);
    return null;
  }

  if (!wantsQuestionImage && !wantsOptionImages) {
    console.warn(`Dropped question with no usable visual prompt: ${question}`);
    return null;
  }

  const layout: QuestionLayout =
    wantsQuestionImage && wantsOptionImages
      ? "image_question_image_options"
      : wantsQuestionImage
        ? "image_question_text_options"
        : "text_question_image_options";

  return {
    id,
    subject,
    class_level: classLevel,
    question,
    concept_key: conceptKey,
    question_type: questionType,
    options,
    answer: options[correctIndex],
    correct_answer: correctIndex,
    explanation:
      typeof item.explanation === "string"
        ? item.explanation.trim()
        : "",
    layout,
    image_required: wantsQuestionImage,
    image_prompt: wantsQuestionImage ? imagePrompt : "",
    option_images_required: wantsOptionImages,
    option_image_prompts:
      wantsOptionImages ? optionImagePrompts : []
  };
}


// ======================================================
// SYSTEM PROMPT
// ======================================================

const SYSTEM_PROMPT = `
You are an expert children's educational content creator, curriculum designer, and assessment specialist.

Your mission is to create engaging, age-appropriate, visually rich multiple-choice questions that make learning enjoyable and meaningful.

Your questions are inspired by Olympiad standards, school curriculum, and real-life learning, but the goal is NOT only Olympiad preparation. The primary objective is to improve children's conceptual understanding, curiosity, logical thinking, creativity, confidence, and healthy screen time through fun learning experiences.

Every question should help a child learn something useful.

Learning should feel like playing, never like taking an exam.

--------------------------------------------------
OUTPUT FORMAT
--------------------------------------------------

Always return STRICT VALID JSON ONLY.

Never return markdown.

Never return code blocks.

Return ONLY the following JSON:

{
  "questions":[
    {
      "question":"string",
      "conceptKey":"lower_snake_case semantic learning target",
      "questionType":"UPPER_SNAKE_CASE generalized reasoning pattern",
      "options":["","","",""],
      "answer":"string",
      "layout":"IMAGE_QUESTION_TEXT_OPTIONS | IMAGE_OPTIONS_ONLY | IMAGE_QUESTION_AND_IMAGE_OPTIONS",
      "imagePrompt":"string",
      "optionImagePrompts":["","","",""]${
        INCLUDE_EXPLANATION
          ? `,
      "explanation":"string"`
          : ""
      }
    }
  ]
}

--------------------------------------------------
QUESTION RULES
--------------------------------------------------

• Generate exactly the requested number of questions.

• Every question must contain:

    question
    conceptKey
    questionType
    options
    answer
    layout
    imagePrompt
    optionImagePrompts${
      INCLUDE_EXPLANATION
        ? `
    explanation`
        : ""
    }

• Every question must have exactly FOUR options.

• There must be ONE and ONLY ONE correct answer.

• The answer field MUST exactly match one option.

• Never generate duplicate questions.

• Never generate duplicate option sets.

--------------------------------------------------
STRICT QUESTION DIVERSITY — CRITICAL
--------------------------------------------------

• conceptKey is the canonical semantic learning target of the question.
  It must ignore superficial wording changes.

• questionType is the generalized reasoning mechanic of the question.
  It must ignore the object, character name, number values and sentence wording.

Examples:

  "How many apples are shown?"
  "Count the balloons."
  => BOTH are questionType: COUNT_VISIBLE_OBJECTS

  "Which animal lives in water?"
  "Where does a fish live?"
  => BOTH belong to the same habitat-matching question type.

  "Which group has more stars?"
  "Choose the basket with more apples."
  => BOTH are questionType: COMPARE_QUANTITY_MORE

• Within one quiz, NEVER reuse a questionType.

• Within one quiz, NEVER reuse a conceptKey.

• Do NOT evade this rule by inventing slightly different keys for the same reasoning pattern.

• Changing only nouns, colors, names, pictures or numbers does NOT make a new question type.

• Rephrasing a sentence does NOT make a new question type.

• If a candidate is too similar to another question, replace it with a question using a genuinely different learning mechanic from the syllabus.

• Every question must test a different concept and a different reasoning pattern.

• Keep questions short, clear and child-friendly.

• Avoid long sentences.

• Use positive language.

• Avoid ambiguity.

• Avoid trick questions.

• Avoid confusing wording.

• Questions should encourage thinking instead of memorization whenever possible.${
  INCLUDE_EXPLANATION
    ? `

• The explanation must be ONE short child-friendly sentence saying why the answer is correct.`
    : ""
}

• Avoid using the same sentence pattern repeatedly.

  Example

  Wrong

  What is...?

  What is...?

  What is...?

  Correct

  Which...

  How many...

  Choose...

  Identify...

  Find...

  Look at the picture and...

--------------------------------------------------
ANSWER RANDOMIZATION
--------------------------------------------------

Across the complete quiz, distribute the correct answers naturally.

Avoid keeping the correct answer in the same option more than twice consecutively.

Do NOT keep the correct answer in the same option position.

Randomly distribute correct answers across Option 1, Option 2, Option 3 and Option 4.

Example distribution:

Q1 -> Option 2

Q2 -> Option 4

Q3 -> Option 1

Q4 -> Option 3

Q5 -> Option 2

The answer positions should appear naturally random.

--------------------------------------------------
QUESTION LAYOUTS — VERY IMPORTANT
--------------------------------------------------

Every question must be VISUAL.

Choose ONE of these three layouts for each question and put
its exact name in the "layout" field.

1. IMAGE_QUESTION_TEXT_OPTIONS

   The question has one picture. The four options are words.

   • imagePrompt describes the question picture
   • optionImagePrompts must be []

2. IMAGE_OPTIONS_ONLY

   The question is text only. All four options are pictures.

   • imagePrompt must be ""
   • optionImagePrompts must contain EXACTLY four prompts,
     one per option, in the SAME ORDER as "options"

3. IMAGE_QUESTION_AND_IMAGE_OPTIONS

   The question has a picture AND all four options are pictures.

   • imagePrompt describes the question picture
   • optionImagePrompts must contain EXACTLY four prompts,
     one per option, in the SAME ORDER as "options"

The user message states how many questions of each layout to
produce. Follow those counts exactly, and mix the layouts
throughout the quiz. Never group all of one layout together.

HOW TO CHOOSE A LAYOUT

Use IMAGE_OPTIONS_ONLY when the four options are things a
child can recognise instantly in a picture: animals, fruits,
vegetables, shapes, colors, objects, vehicles, places,
monuments, actions, tools, body parts, plants.

Use IMAGE_QUESTION_TEXT_OPTIONS when the options are numbers,
words, letters, names, sentences or ideas that cannot be drawn
without writing text.

Use IMAGE_QUESTION_AND_IMAGE_OPTIONS when the child must look
at something AND pick a picture: matching, pattern completion,
"what comes next", odd one out, shadow matching, grouping,
finding the missing figure.

NEVER choose a picture layout for options that would need
letters, numbers or words drawn inside the picture. A child
must never have to read text inside an illustration.

--------------------------------------------------
OPTION IMAGE RULES
--------------------------------------------------

• Exactly FOUR optionImagePrompts, one per option, in the
  same order as the options array.

• Each option prompt describes ONE single subject, centered,
  large, on a plain flat white background, with nothing else
  in the frame.

• The four option pictures must be PARALLEL: the same kind of
  subject, the same style, the same size, the same level of
  detail. If option 1 is a cartoon cat, option 2 must be a
  cartoon animal drawn exactly the same way.

• The four option pictures must be clearly DIFFERENT from each
  other so a child can tell them apart instantly.

• Never make the correct option bigger, brighter, glowing,
  ticked, circled, decorated or more detailed. All four must
  look equally appealing.

• Never put text, letters, numbers, labels, A/B/C/D marks,
  arrows or ticks inside an option picture.

• The "options" text is still required and must exactly name
  what its picture shows. It is used for reading aloud and for
  accessibility.

Example

Question: Which animal lives in water?
Options: ["Fish", "Cat", "Cow", "Hen"]
optionImagePrompts:
  "A single cheerful orange cartoon fish swimming, centered on a plain white background."
  "A single cheerful cartoon cat sitting, centered on a plain white background."
  "A single cheerful cartoon cow standing, centered on a plain white background."
  "A single cheerful cartoon hen standing, centered on a plain white background."

--------------------------------------------------
IMAGE RULES
--------------------------------------------------

Every question MUST be illustrated — with imagePrompt, with
optionImagePrompts, or with both.

The image prompts are EXTREMELY IMPORTANT.

The generated images must help children answer the question.

The imagePrompt must describe the EXACT scene required by the question.

Every quantity, object, color, shape, animal or person mentioned in the question must exactly match the imagePrompt.

The imagePrompt must never introduce extra objects that could confuse the child.

--------------------------------------------------
DRAW THE QUESTION, NEVER THE ANSWER
--------------------------------------------------

This is the MOST IMPORTANT image rule.

The question image must show ONLY the information the child is
GIVEN in the question.

The question image must NEVER show the RESULT the child is
asked to work out.

The child must still have to think.

If the image already contains the answer, the question
is worthless.

When the options are pictures, the question image must NEVER
show the same object as the correct option picture.

DIRECT COUNTING QUESTIONS

If the question simply asks the child to count or
identify what is shown, then the objects in the image
ARE the given information, so draw them exactly.

Example

Question:
How many apples are in the basket?

Answer:
5

Correct imagePrompt:
A wooden basket containing exactly five bright red apples.

Incorrect:
A basket containing four apples.

CALCULATION QUESTIONS

If the child must add, subtract, multiply, divide,
compare or reason to reach the answer, draw ONLY the
starting situation.

NEVER draw the leftover group.

NEVER draw the total group.

NEVER draw the result group.

NEVER draw a second "after" scene.

Example

Question:
There are 12 apples. 4 apples are eaten. How many apples are left?

Answer:
8

Correct imagePrompt:
A cartoon basket holding twelve bright red apples, with a
cheerful child reaching towards the basket.

Incorrect:
A basket of twelve apples beside a separate pile of exactly
eight apples.
Reason: the pile of eight IS the answer.

Incorrect:
Twelve apples, four apple cores, and eight whole apples.
Reason: it shows the answer and adds confusing extra objects.

Example

Question:
Which shape has 3 sides?

Answer:
Triangle

Correct layout:
IMAGE_OPTIONS_ONLY

Correct optionImagePrompts:
Four separate pictures, each showing ONE flat cartoon shape,
same size and same brightness: a circle, a square, a triangle,
a star.

Incorrect:
A large glowing triangle in the center of the picture.
Reason: highlighting the triangle gives the answer away.

COUNT CHECK

Before writing an image prompt, count every group of
objects you are describing.

The numbers in the imagePrompt must be the numbers GIVEN
in the question.

The number in the answer must NOT appear as its own group
of objects, unless the question is a direct counting
question.

Never draw arrows, highlights, glows, circles, ticks,
stars or spotlights that point at the correct option.

--------------------------------------------------
MATHEMATICS
--------------------------------------------------

For Mathematics, use real objects whenever possible.

Examples

Apples

Balls

Flowers

Stars

Toys

Pencils

Books

Birds

Never use printed equations inside the image.

Number options must be TEXT options, never pictures.

--------------------------------------------------
ENGLISH
--------------------------------------------------

Images should clearly represent the word, object or action.

Letters and spellings must be TEXT options, never pictures.

--------------------------------------------------
SCIENCE
--------------------------------------------------

Images should accurately represent the scientific object or concept.

--------------------------------------------------
GENERAL KNOWLEDGE
--------------------------------------------------

Images should accurately represent the place, animal, monument, flag, occupation, person or object.

--------------------------------------------------
LIFE SKILLS & VALUES
--------------------------------------------------

Images should show positive everyday situations.

Examples

Helping parents

Sharing toys

Throwing waste into a dustbin

Crossing the road safely

Washing hands

Respecting elders

Saving water

Planting trees

--------------------------------------------------
COMPUTER STUDIES
--------------------------------------------------

Images should accurately represent computer parts, devices or simple digital activities.

--------------------------------------------------
IMAGE STYLE
--------------------------------------------------

Every image prompt should generate:

• Bright colors

• Cartoon style

• Modern vector illustration

• Child friendly

• White background

• Simple composition

• Easy to understand

Never include

Text

Letters

Numbers

Watermarks

Logos

Brand names

--------------------------------------------------
QUALITY
--------------------------------------------------

Every question should teach one useful concept.

Children should feel that they learned something after answering.

Avoid repetitive patterns.

Avoid boring questions.

Generate engaging educational content.

Return STRICT VALID JSON ONLY.
`;


// ======================================================
// USER PROMPT
// ======================================================

function buildUserPrompt(params: {
  subject: string;
  classLevel: string;
  difficulty: string;
  questionCount: number;
  layouts: {
    imageQuestion: number;
    imageOptions: number;
    both: number;
  };
  syllabusText: string;
  avoidQuestions?: string[];
  avoidQuestionTypes?: string[];
  avoidConceptKeys?: string[];
}): string {

  const {
    subject,
    classLevel,
    difficulty,
    questionCount,
    layouts,
    syllabusText,
    avoidQuestions,
    avoidQuestionTypes,
    avoidConceptKeys
  } = params;


  const avoidBlock =
    avoidQuestions && avoidQuestions.length > 0
      ? `
---------------------------------------
ALREADY GENERATED — DO NOT REPEAT
---------------------------------------

These questions already exist in this generation.
Do NOT repeat, rephrase, reskin or numerically vary them:

${avoidQuestions.map((q) => `- ${q}`).join("\n")}
`
      : "";


  const avoidTypeBlock =
    avoidQuestionTypes && avoidQuestionTypes.length > 0
      ? `
---------------------------------------
QUESTION TYPES ALREADY USED — FORBIDDEN
---------------------------------------

Do NOT create another question with any of these reasoning patterns,
even with different objects, names, colors, numbers or wording:

${avoidQuestionTypes.map((t) => `- ${t}`).join("\n")}
`
      : "";


  const avoidConceptBlock =
    avoidConceptKeys && avoidConceptKeys.length > 0
      ? `
---------------------------------------
CONCEPTS ALREADY USED — FORBIDDEN
---------------------------------------

Do NOT test these semantic learning targets again:

${avoidConceptKeys.map((c) => `- ${c}`).join("\n")}
`
      : "";


  return `
Generate a learning quiz.

Class Level:
${classLevel}

Subject:
${subject}

Difficulty:
${difficulty}

Number of Questions:
${questionCount}

STRICTLY use ONLY the following syllabus for this class.

SYLLABUS

${syllabusText}
${avoidBlock}
${avoidTypeBlock}
${avoidConceptBlock}
---------------------------------------
REQUIRED LAYOUT MIX
---------------------------------------

Of the ${questionCount} questions:

• ${layouts.imageQuestion} question(s) must use IMAGE_QUESTION_TEXT_OPTIONS
  (one picture for the question, four word options)

• ${layouts.imageOptions} question(s) must use IMAGE_OPTIONS_ONLY
  (text question, four picture options, imagePrompt = "")

• ${layouts.both} question(s) must use IMAGE_QUESTION_AND_IMAGE_OPTIONS
  (picture question AND four picture options)

Mix these layouts throughout the list. Do NOT put all the
picture-option questions together at the end.

Pick the layout that genuinely suits each question. Numbers,
letters, spellings and sentences must always be TEXT options.
Animals, fruits, shapes, objects, places and actions are ideal
as PICTURE options.

---------------------------------------
INSTRUCTIONS
---------------------------------------

1. Generate exactly ${questionCount} questions. This is a hard requirement — never return fewer.

2. Every question MUST be based ONLY on the provided syllabus.

3. Never generate questions outside the syllabus.

4. Every question MUST use a different conceptKey AND a different questionType.
Changing only wording, nouns, names, colors or numbers is NOT enough.

5. Questions should be educational, engaging and fun.

6. Use simple, child-friendly language suitable for ${classLevel}.

7. Follow the requested difficulty level strictly.

Difficulty Guidelines

Easy
• Recognition
• Observation
• Simple counting
• Direct identification
• One-step thinking

Medium
• Comparison
• Classification
• Two-step reasoning
• Simple problem solving
• Basic application

Hard
• Olympiad-inspired thinking
• Pattern recognition
• Multi-step reasoning
• Logical thinking
• Analytical questions

8. Every question must have exactly FOUR options.

9. Only ONE option should be correct.

10. The answer field must exactly match one option.

11. Randomize the correct answer position across all questions.
Do NOT keep the correct answer in the same option position.

12. Never repeat or rephrase the same question.

13. Never repeat the same option set, even in a different order.

14. Never reuse a questionType in this quiz.

15. Never reuse a conceptKey in this quiz.

16. Before finalizing each candidate, mentally compare its reasoning mechanic with all earlier questions. If it is the same type, replace it.

17. Set the "layout" field on every question, and fill the image
prompts that layout requires.

---------------------------------------
IMAGE PROMPT RULES
---------------------------------------

The images must perfectly match the question and the options.

The images must help the child answer the question.

The images must NEVER give the answer away.

If the question involves counting, the question image MUST
contain the exact number of objects mentioned in the question.

Example

Question:
How many apples are there?

Answer:
5

Image Prompt:
A basket containing exactly five bright red apples.

Wrong:
A basket containing four apples.

PICTURE OPTIONS

Each option prompt describes ONE subject only, centered on a
plain white background, with nothing else in the frame.

All four option pictures must share the same style, the same
size and the same level of detail.

Never highlight, enlarge, tick, circle or decorate the correct
option picture.

Never include text, letters, numbers or A/B/C/D labels inside
an option picture.

For Mathematics:
Use objects like apples, stars, pencils, flowers, toys, birds or balls whenever appropriate. Number options stay as text.

For English:
Show the object, animal or action clearly. Letters and words stay as text options.

For Science:
Show the actual concept or object.

For General Knowledge:
Show the place, monument, animal, flag, occupation or object.

For Life Skills & Values:
Show positive real-life situations.

For Computer Studies:
Show computer devices, parts or simple digital activities.

Image Style

• Bright colors
• Cartoon style
• Child-friendly
• Modern vector illustration
• White background
• Simple composition
• Easy to understand

Do NOT include

• Text
• Letters
• Numbers
• Watermarks
• Logos

Return ONLY valid JSON.
`;
}


// ======================================================
// RESPONSE SCHEMA FOR GEMINI
//
// Gemini uses an OpenAPI 3.0 subset:
//   - types are UPPERCASE strings
//   - "additionalProperties" is NOT supported
//   - "propertyOrdering" keeps the model's field order
//     stable, which noticeably improves reliability
//
// Field order matters here: the model picks the layout
// BEFORE it writes the prompts, which keeps the two
// consistent with each other.
// ======================================================

function questionSchema() {

  const properties: Record<string, unknown> = {

    question: {
      type: "STRING"
    },

    conceptKey: {
      type: "STRING"
    },

    questionType: {
      type: "STRING"
    },

    options: {
      type: "ARRAY",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "STRING"
      }
    },

    answer: {
      type: "STRING"
    },

    layout: {
      type: "STRING",
      format: "enum",
      enum: [
        "IMAGE_QUESTION_TEXT_OPTIONS",
        "IMAGE_OPTIONS_ONLY",
        "IMAGE_QUESTION_AND_IMAGE_OPTIONS"
      ]
    },

    imagePrompt: {
      type: "STRING"
    },

    optionImagePrompts: {
      type: "ARRAY",
      maxItems: 4,
      items: {
        type: "STRING"
      }
    }
  };


  const ordering = [
    "question",
    "conceptKey",
    "questionType",
    "options",
    "answer",
    "layout",
    "imagePrompt",
    "optionImagePrompts"
  ];


  const required = [
    "question",
    "conceptKey",
    "questionType",
    "options",
    "answer",
    "layout",
    "imagePrompt",
    "optionImagePrompts"
  ];


  if (INCLUDE_EXPLANATION) {

    properties.explanation = {
      type: "STRING"
    };

    ordering.push("explanation");
    required.push("explanation");
  }


  return {

    type: "OBJECT",

    properties: {

      questions: {

        type: "ARRAY",

        items: {
          type: "OBJECT",
          properties,
          propertyOrdering: ordering,
          required
        }
      }
    },

    required: [
      "questions"
    ],

    propertyOrdering: [
      "questions"
    ]
  };
}


// ======================================================
// RETRY WRAPPER FOR TEXT GENERATION
// ======================================================

async function generateQuestionsWithRetry(
  params: {
    subject: string;
    classLevel: string;
    difficulty: string;
    questionCount: number;
    layouts: {
      imageQuestion: number;
      imageOptions: number;
      both: number;
    };
    syllabusText: string;
    avoidQuestions?: string[];
    avoidQuestionTypes?: string[];
    avoidConceptKeys?: string[];
  },
  env: Env
): Promise<ModelQuestion[]> {

  let lastError: unknown;

  for (let attempt = 0; attempt < TEXT_ATTEMPTS; attempt++) {
    try {
      return await generateQuestions(params, env);
    } catch (error) {
      lastError = error;

      console.warn(
        `Text generation attempt ${attempt + 1} failed for ${params.subject}:`,
        error instanceof Error ? error.message : String(error)
      );

      // Last attempt — don't bother sleeping
      if (attempt === TEXT_ATTEMPTS - 1) {
        break;
      }

      // Exponential backoff: 1000ms, then 2000ms
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * (attempt + 1))
      );
    }
  }

  throw lastError;
}


// ======================================================
// GENERATE QUESTIONS USING GEMINI
// ======================================================

async function generateQuestions(
  params: {
    subject: string;
    classLevel: string;
    difficulty: string;
    questionCount: number;
    layouts: {
      imageQuestion: number;
      imageOptions: number;
      both: number;
    };
    syllabusText: string;
    avoidQuestions?: string[];
    avoidQuestionTypes?: string[];
    avoidConceptKeys?: string[];
  },
  env: Env
): Promise<ModelQuestion[]> {

  const response = await fetch(
    `${GEMINI_BASE}/${TEXT_MODEL}:generateContent`,
    {
      method: "POST",

      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "Content-Type": "application/json"
      },

      body: JSON.stringify({

        systemInstruction: {
          parts: [
            {
              text: SYSTEM_PROMPT
            }
          ]
        },

        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildUserPrompt(params)
              }
            ]
          }
        ],

        generationConfig: {

          // Forces valid JSON matching the schema
          responseMimeType: "application/json",

          responseSchema: questionSchema(),

          // Some variety so repeated quizzes differ
          temperature: 1.0,

          // Option prompts add roughly 4x the text per
          // question, so this ceiling had to go up.
          maxOutputTokens: 16384,

          thinkingConfig: {
            thinkingBudget: THINKING_BUDGET
          }
        },

        // Children's content, so keep the default filters
        // but don't let harmless school words get blocked.
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_LOW_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          }
        ]
      })
    }
  );


  // ==================================================
  // READ GEMINI RESPONSE
  // ==================================================

  const result = await response.json() as any;

  console.log(
    `Gemini HTTP Status (${params.subject}):`,
    response.status
  );


  if (!response.ok) {

    console.error(
      "Gemini Response:",
      JSON.stringify(result)
    );

    throw new Error(
      `Gemini API error: ${JSON.stringify(result?.error ?? result)}`
    );
  }


  // ==================================================
  // BLOCKED PROMPT
  // ==================================================

  if (result?.promptFeedback?.blockReason) {

    throw new Error(
      `Gemini blocked the prompt: ${result.promptFeedback.blockReason}`
    );
  }


  // ==================================================
  // FIND GENERATED TEXT
  // ==================================================

  const candidate =
    Array.isArray(result.candidates)
      ? result.candidates[0]
      : null;


  if (!candidate) {

    console.error(
      "FULL GEMINI RESPONSE:",
      JSON.stringify(result, null, 2)
    );

    throw new Error(
      "Gemini returned no candidates. Check Worker logs."
    );
  }


  const finishReason: string =
    candidate.finishReason ?? "";


  if (
    finishReason &&
    finishReason !== "STOP" &&
    finishReason !== "MAX_TOKENS"
  ) {

    throw new Error(
      `Gemini stopped early: ${finishReason}`
    );
  }


  const outputText =
    Array.isArray(candidate.content?.parts)
      ? candidate.content.parts
          .map(
            (part: any) =>
              typeof part.text === "string"
                ? part.text
                : ""
          )
          .join("")
          .trim()
      : "";


  if (!outputText) {

    console.error(
      "FULL GEMINI RESPONSE:",
      JSON.stringify(result, null, 2)
    );

    throw new Error(
      "Gemini returned no output text. Check Worker logs."
    );
  }


  // ==================================================
  // PARSE JSON
  // ==================================================

  const cleaned =
    outputText
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();


  try {

    const parsed =
      JSON.parse(cleaned);

    if (
      !parsed.questions ||
      !Array.isArray(parsed.questions)
    ) {

      throw new Error(
        "Gemini JSON does not contain questions array"
      );
    }

    return parsed.questions as ModelQuestion[];

  } catch (error) {

    console.error(
      "INVALID GEMINI JSON:",
      cleaned
    );

    throw new Error(
      `Failed to parse Gemini JSON: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }
}


// ======================================================
// IMAGE GENERATION INTENTIONALLY REMOVED
//
// This worker returns image_prompt and option_image_prompts only.
// Generate those images later in your dedicated image pipeline.
// ======================================================


// ======================================================
// JSON RESPONSE HELPER
// ======================================================

function json(
  data: unknown,
  status = 200
): Response {

  return new Response(
    JSON.stringify(data),
    {

      status,

      headers: {

        ...corsHeaders,

        "Content-Type":
          "application/json"
      }
    }
  );
}


// ======================================================
// KIDZENAI SYLLABUS
// ======================================================

type ClassLevel =
  | "Nursery"
  | "LKG"
  | "UKG"
  | "Class 1"
  | "Class 2"
  | "Class 3";

type SyllabusMap = Record<
  string,
  Record<string, string>
>;


const syllabus: SyllabusMap = {
  "Bengali": {
    "Nursery": "বাংলা স্বরবর্ণ ও ব্যঞ্জনবর্ণ পরিচয়; ছবি ও বর্ণ মেলানো।",
    "LKG": "স্বরবর্ণ, ব্যঞ্জনবর্ণ, বর্ণ চেনা, ছবি ও বর্ণ মেলানো, সহজ শব্দ।",
    "UKG": "স্বরবর্ণ, ব্যঞ্জনবর্ণ, কারচিহ্ন, সহজ শব্দ গঠন, বর্ণ বিশ্লেষণ, ছবি ও বর্ণ মেলানো।",
    "Class 1": "বাংলা শব্দ গঠন, বানান, বাক্য গঠন, কারচিহ্ন, সহজ পাঠ।",
    "Class 2": "বাংলা বানান, বাক্য রচনা, শব্দার্থ, বিপরীত শব্দ, সহজ অনুচ্ছেদ।",
    "Class 3": "বাংলা ব্যাকরণ, শব্দার্থ, বিপরীত শব্দ, অনুচ্ছেদ, পাঠ অনুধাবন।"
  },

  "Mathematics": {
    "Nursery": `
- Identify numbers 1 to 5
- Count objects up to 5
- Count fingers
- Count toys
- Count fruits
- Count animals
- Big and Small
- Tall and Short
- Long and Short
- Heavy and Light
- More and Less
- Same and Different
- Match same objects
- Match same numbers
- Circle and Square
- Triangle
- Rectangle
- Basic Shapes
- Identify Colors
- Sort by Color
- Sort by Shape
- Identify Groups
- One and Many
- Inside and Outside
- Up and Down
- Near and Far
- Left and Right (basic)
- Full and Empty
- First and Last
- Simple Pattern Recognition
`,

    "LKG": `
- Numbers 1 to 10
- Number Recognition
- Count objects up to 10
- Missing numbers up to 10
- Before numbers up to 10
- After numbers up to 10
- Between numbers up to 10
- Bigger number
- Smaller number
- Equal numbers
- Addition within 5
- Subtraction within 5
- Number Matching
- Number Ordering
- Shapes
- Identify 2D Shapes
- Compare Sizes
- More and Less
- Odd One Out
- Simple Patterns
- Continue the Pattern
- Object Classification
- Position Words
- Left and Right
- Top and Bottom
- Near and Far
- Counting Forward
- Counting Backward
`,

    "UKG": `
- Numbers 1 to 20
- Count objects up to 20
- Missing numbers
- Before, After and Between numbers
- Ascending Order
- Descending Order
- Compare Numbers
- Greater Than
- Less Than
- Equal To
- Addition within 10
- Subtraction within 10
- Number Bonds
- Mental Maths
- Skip Counting by 2
- Shapes
- Solid Shapes
- Symmetry (basic)
- Simple Measurement
- Longer and Shorter
- Heavier and Lighter
- Capacity (Full and Half)
- Time (Morning, Afternoon, Evening, Night)
- Days of the Week
- Calendar Basics
- Money Recognition
- Patterns
- Picture Graphs (basic)
- Logical Counting
`,

    "Class 1": `
- Numbers up to 100
- Number Names
- Count Forward
- Count Backward
- Before Numbers
- After Numbers
- Between Numbers
- Ascending Order
- Descending Order
- Place Value (Ones and Tens)
- Expanded Form
- Compare Numbers
- Greater Than
- Less Than
- Equal To
- Odd and Even Numbers
- Addition without Carry
- Addition with Carry
- Subtraction without Borrow
- Subtraction with Borrow
- Missing Numbers
- Number Patterns
- Skip Counting by 2
- Skip Counting by 5
- Skip Counting by 10
- Mental Mathematics
- Simple Word Problems
- Ordinal Numbers
- Shapes
- 2D Shapes
- 3D Shapes
- Measurement of Length
- Weight
- Capacity
- Time (Clock Reading)
- Calendar
- Days and Months
- Indian Currency
- Data Handling (Picture Graph)
`,

    "Class 2": `
- Numbers up to 1000
- Number Names
- Place Value (Hundreds, Tens, Ones)
- Expanded Form
- Compare Numbers
- Ascending Order
- Descending Order
- Even and Odd Numbers
- Addition (3-digit)
- Subtraction (3-digit)
- Carry and Borrow
- Mental Mathematics
- Multiplication Tables (2 to 10)
- Multiplication Concepts
- Repeated Addition
- Division as Equal Sharing
- Division Facts
- Fractions (Half, Quarter)
- Shapes
- Lines and Curves
- Symmetry
- Measurement
- Length
- Weight
- Capacity
- Time
- Calendar
- Money
- Word Problems
- Picture Graphs
- Bar Graphs (basic)
- Patterns
- Logical Number Sequences
`,

    "Class 3": `
- Numbers up to 10000
- Place Value
- Expanded Form
- Compare Large Numbers
- Ascending and Descending Order
- Roman Numerals
- Addition
- Subtraction
- Multiplication
- Division
- Multiplication Tables up to 20
- Mental Mathematics
- Estimation
- Fractions
- Equivalent Fractions
- Number Patterns
- Factors and Multiples (basic)
- Even and Odd Numbers
- Geometry
- Angles
- Lines
- 2D Shapes
- 3D Shapes
- Perimeter (basic)
- Measurement
- Time
- Calendar
- Money
- Data Handling
- Picture Graphs
- Bar Graphs
- Pictographs
- Word Problems
- Logical Mathematical Reasoning
- Olympiad-style Number Puzzles
- Pattern Recognition
`,
  },

  "English": {
    "Nursery": `
- Recognize Capital Alphabets (A-Z)
- Recognize Small Alphabets (a-z)
- Identify Alphabet Shapes
- Match Same Alphabets
- Alphabet Sequencing
- Missing Alphabet
- Alphabet Recognition through Pictures
- Letter Sounds (Basic Phonics)
- Identify Common Objects
- Fruits Vocabulary
- Vegetables Vocabulary
- Animals Vocabulary
- Birds Vocabulary
- Colors Vocabulary
- Body Parts Vocabulary
- Family Members
- Common Daily Objects
- Greetings (Hello, Hi, Bye)
- Polite Words (Please, Thank You, Sorry)
- Opposite Words (Big-Small, Hot-Cold)
- Same and Different
- Picture Identification
- Object Matching
- Listening and Observation
`,

    "LKG": `
- Capital and Small Alphabets
- Alphabet Order
- Missing Letters
- Before and After Letters
- Beginning Sounds
- Ending Sounds
- Vowel Recognition (A, E, I, O, U)
- Simple Phonics
- Match Letters with Pictures
- Two-Letter Words
- Three-Letter Words (CVC)
- Rhyming Words
- Opposite Words
- Action Words
- Naming Words
- Colors
- Fruits
- Vegetables
- Animals
- Birds
- Body Parts
- Family Members
- Daily Use Objects
- Classroom Objects
- Simple Picture Reading
- Identify Correct Picture
- Listening Skills
`,

    "UKG": `
- Alphabet Revision
- Alphabet Sequencing
- Missing Letters
- Vowels and Consonants
- Phonics Sounds
- Three-Letter Words
- Four-Letter Words
- Sight Words
- Rhyming Words
- Opposite Words
- Action Words
- Naming Words
- Singular and Plural (Basic)
- One and Many
- Articles (A, An)
- This and That
- These and Those
- Picture Reading
- Sentence Reading
- Complete the Sentence
- Match Word with Picture
- Animals
- Birds
- Fruits
- Vegetables
- Occupations
- Household Objects
- Days of the Week
- Months (Recognition)
`,

    "Class 1": `
- Alphabet Revision
- Vowels and Consonants
- Phonics
- Blending Sounds
- Sight Words
- Word Families
- Synonyms (Basic)
- Opposites
- Singular and Plural
- Articles (A, An, The)
- Pronouns (Basic)
- Naming Words (Nouns)
- Action Words (Verbs)
- Describing Words (Adjectives)
- Prepositions (In, On, Under, Behind)
- Joining Words (And, But)
- Simple Sentences
- Sentence Completion
- Rearranging Sentences
- Reading Comprehension
- Picture Comprehension
- Story Sequencing
- Punctuation (Full Stop, Question Mark)
- Capital Letters
- Days of the Week
- Months of the Year
- Greetings and Conversation
`,

    "Class 2": `
- Vocabulary Building
- Phonics
- Silent Letters
- Compound Words
- Synonyms
- Antonyms
- Homophones (Basic)
- Singular and Plural
- Nouns
- Proper Nouns
- Pronouns
- Verbs
- Helping Verbs
- Adjectives
- Adverbs (Basic)
- Articles
- Prepositions
- Conjunctions
- Punctuation
- Capitalization
- Sentence Formation
- Sentence Correction
- Question and Answer
- Reading Comprehension
- Picture Comprehension
- Story Completion
- Sequencing Events
- Idioms (Basic)
- Everyday Conversation
`,

    "Class 3": `
- Vocabulary Enrichment
- Synonyms
- Antonyms
- Homophones
- Homonyms (Basic)
- Prefixes
- Suffixes
- Compound Words
- Alphabetical Order
- Dictionary Skills
- Parts of Speech
- Nouns
- Pronouns
- Verbs
- Helping Verbs
- Adjectives
- Adverbs
- Prepositions
- Conjunctions
- Articles
- Tenses (Simple Present, Past, Future)
- Subject-Verb Agreement
- Punctuation
- Direct and Indirect Questions (Basic)
- Reading Comprehension
- Inference from Pictures
- Story Sequencing
- Paragraph Understanding
- Grammar Correction
- Creative Thinking through Language
- Olympiad-style English Reasoning
`,
  },

  "Science": {
    "Nursery": `
- My Body Parts
- Sense Organs
- Healthy Food
- Unhealthy Food
- Fruits
- Vegetables
- Domestic Animals
- Wild Animals
- Pet Animals
- Birds
- Insects
- Water Animals
- Trees
- Plants
- Flowers
- Weather (Sunny, Rainy, Cloudy)
- Day and Night
- Seasons (Basic)
- Clothes We Wear
- Food We Eat
- Home Objects
- Family Members
- Good Habits
- Cleanliness
- Personal Hygiene
- Safe and Unsafe Objects
- Transport (Basic)
- Community Helpers
`,

    "LKG": `
- Human Body
- Body Parts and Their Uses
- Five Sense Organs
- Healthy Eating Habits
- Fruits and Vegetables
- Domestic Animals
- Wild Animals
- Farm Animals
- Birds
- Insects
- Water Animals
- Animal Homes
- Animal Babies
- Plants Around Us
- Trees and Flowers
- Uses of Plants
- Air
- Water
- Weather
- Seasons
- Day and Night
- Clothes for Different Seasons
- Means of Transport
- Types of Houses
- Family
- Community Helpers
- Personal Hygiene
- Clean Surroundings
- Good Habits
`,

    "UKG": `
- Human Body
- Sense Organs
- Healthy and Unhealthy Food
- Balanced Food (Basic)
- Domestic, Wild and Pet Animals
- Birds
- Insects
- Water Animals
- Animal Food
- Animal Homes
- Animal Sounds
- Plants
- Parts of a Plant
- Trees, Shrubs and Herbs
- Uses of Plants
- Living and Non-Living Things
- Air Around Us
- Water Around Us
- Sources of Water
- Uses of Water
- Weather
- Seasons
- Day and Night
- Our Earth (Basic)
- Transport
- Communication (Basic)
- Houses
- Community Helpers
- Safety Rules
- Cleanliness
`,

    "Class 1": `
- Living and Non-Living Things
- Human Body Parts
- Sense Organs and Their Functions
- Healthy Food
- Junk Food
- Balanced Diet (Basic)
- Personal Hygiene
- Exercise
- Domestic Animals
- Wild Animals
- Pet Animals
- Birds
- Insects
- Animal Babies
- Animal Homes
- Animal Food
- Plants Around Us
- Parts of Plants
- Uses of Plants
- Trees, Herbs and Shrubs
- Air
- Water
- Importance of Water
- Sources of Water
- Weather
- Seasons
- Day and Night
- Sun, Moon and Stars
- Our Earth
- Rocks and Soil (Basic)
- Transport
- Communication
- Types of Houses
- Community Helpers
- Good Habits
- Road Safety
- Keeping Our Environment Clean
`,

    "Class 2": `
- Living and Non-Living Things
- Plant Life
- Parts of Plants
- Plant Growth
- Uses of Plants
- Animals Around Us
- Food Habits of Animals
- Animal Adaptations (Basic)
- Human Body
- Sense Organs
- Healthy Lifestyle
- Balanced Diet
- Exercise
- Cleanliness
- Air
- Water
- Water Conservation
- Weather
- Seasons
- Natural Resources
- Rocks and Soil
- Our Earth
- Solar System (Introduction)
- Sun, Moon and Stars
- Shadows
- Light (Basic)
- Sound (Basic)
- Force (Push and Pull)
- Magnets (Introduction)
- Means of Transport
- Communication
- Pollution (Basic)
- Save Environment
- Reduce, Reuse and Recycle
- Community Helpers
- Safety at Home and School
`,

    "Class 3": `
- Living and Non-Living Things
- Classification of Animals
- Vertebrates and Invertebrates (Basic)
- Animal Adaptations
- Food Chain (Introduction)
- Plant Life Cycle
- Photosynthesis (Basic Concept)
- Parts of Plants
- Uses of Plants
- Human Body Systems (Basic)
- Bones and Muscles
- Sense Organs
- Nutrition
- Balanced Diet
- Personal Hygiene
- Air
- Water
- Water Cycle
- Weather
- Climate (Basic)
- States of Matter (Basic)
- Solids, Liquids and Gases
- Force and Motion
- Friction (Basic)
- Light
- Shadows
- Reflection (Basic)
- Sound
- Magnets
- Electricity (Basic Safety)
- Our Earth
- Solar System
- Planets
- Moon
- Natural Resources
- Pollution
- Conservation of Nature
- Reduce, Reuse and Recycle
- Simple Machines (Introduction)
- Science in Daily Life
- Observation and Scientific Thinking
`,
  },

  "General Knowledge": {
    "Nursery": `
- My Name
- My Age
- My Family
- My Home
- My School
- My Classroom
- My Teacher
- My Friends
- Colors Around Us
- Common Fruits
- Common Vegetables
- Domestic Animals
- Wild Animals
- Birds
- Insects
- Flowers
- Trees
- Vehicles
- Community Helpers
- Clothes We Wear
- Food We Eat
- Toys
- Festivals (Basic)
- National Flag (Recognition)
- Good Manners
- Healthy Habits
- Weather
- Day and Night
`,

    "LKG": `
- Myself
- Family Members
- School
- Classroom Objects
- Community Helpers
- Domestic Animals
- Wild Animals
- Birds
- Water Animals
- Insects
- Fruits
- Vegetables
- Healthy Food
- National Flag
- National Animal
- National Bird
- National Flower
- Seasons
- Weather
- Means of Transport
- Traffic Lights
- Festivals of India
- Famous Monuments (Recognition)
- Good Habits
- Cleanliness
- Safety Rules
- Our Environment
- Earth, Sun and Moon (Basic)
`,

    "UKG": `
- My Country India
- National Flag
- National Anthem (Recognition)
- National Animal
- National Bird
- National Flower
- National Fruit
- National Tree
- National Currency
- States and Capitals (Basic Awareness)
- Famous Festivals
- Famous Indian Monuments
- Community Helpers
- Means of Transport
- Road Signs (Basic)
- Seasons
- Weather
- Planets (Recognition)
- Earth
- Sun
- Moon
- Animals and Their Homes
- Birds
- Water Animals
- Healthy Lifestyle
- Good Citizenship
- Environment
- Save Water
- Save Trees
`,

    "Class 1": `
- India and Its National Symbols
- Indian Flag
- National Anthem
- National Song
- National Animal
- National Bird
- National Flower
- National Tree
- National Fruit
- Currency of India
- Famous Indian Festivals
- States and Capitals (Basic)
- Famous Indian Monuments
- Important Days
- Community Helpers
- Means of Transport
- Road Safety
- Traffic Symbols
- Continents (Introduction)
- Oceans (Introduction)
- Planets
- Solar System
- Famous Animals
- Birds Around Us
- Trees Around Us
- Healthy Food
- Environment
- Water Conservation
- Good Citizenship
- Famous Personalities (Basic)
- Sports (Basic)
`,

    "Class 2": `
- India and Its States
- Capitals of Major States
- National Symbols
- Constitution (Basic Awareness)
- Famous Freedom Fighters
- Famous Indian Leaders
- Indian Festivals
- Indian Culture
- Famous Monuments
- Important Days
- World Continents
- Major Oceans
- Solar System
- Planets
- Earth
- Moon
- Weather
- Environment
- Wildlife
- Endangered Animals
- Community Helpers
- Transport
- Communication
- Inventions (Basic)
- Famous Scientists
- Famous Sports
- Sports Personalities
- Healthy Living
- Save Water
- Save Trees
- Good Citizenship
`,

    "Class 3": `
- India: States and Capitals
- National Symbols
- Constitution (Basic)
- Parliament (Introduction)
- Freedom Fighters
- Indian History (Basic)
- Indian Geography (Basic)
- Famous Rivers
- Mountains
- National Parks
- Wildlife Sanctuaries
- Continents
- Oceans
- Countries and Capitals (Basic)
- World Landmarks
- Solar System
- Planets
- Space Exploration (Basic)
- Environment
- Climate
- Natural Resources
- Renewable Energy
- Famous Scientists
- Great Inventors
- Famous Personalities
- Nobel Prize (Basic Awareness)
- Olympic Games
- Sports Personalities
- World Organizations (Basic)
- Current Awareness (Age Appropriate)
- Good Citizenship
- Sustainable Living
`,
  },

  "Life Skills & Values": {
    "Nursery": `
- Greeting Others
- Saying Please
- Saying Thank You
- Saying Sorry
- Sharing Toys
- Taking Turns
- Helping Parents
- Helping Friends
- Respecting Elders
- Listening Carefully
- Following Simple Instructions
- Washing Hands
- Brushing Teeth
- Bathing Daily
- Wearing Clean Clothes
- Eating Healthy Food
- Drinking Water
- Keeping Toys Organized
- Throwing Waste in Dustbin
- Loving Animals
- Caring for Plants
- Being Kind
- Speaking Politely
- Identifying Good and Bad Habits
- Being Honest
- Waiting Patiently
- Keeping Classroom Clean
- Smiling and Being Friendly
`,

    "LKG": `
- Good Manners
- Respect for Parents
- Respect for Teachers
- Respect for Friends
- Sharing and Caring
- Helping Others
- Teamwork
- Honesty
- Kindness
- Responsibility
- Washing Hands Properly
- Brushing Teeth Twice Daily
- Healthy Eating Habits
- Exercise and Play
- Keeping Personal Belongings Safe
- Clean Classroom
- Keeping Home Clean
- Throwing Garbage in Dustbin
- Saving Water
- Switching Off Lights
- Caring for Nature
- Caring for Animals
- Road Safety (Basic)
- Stranger Safety (Basic)
- Safe Touch and Unsafe Touch (Age Appropriate)
- Waiting for Your Turn
- Speaking the Truth
- Saying Sorry When Wrong
`,

    "UKG": `
- Respecting Everyone
- Helping at Home
- Helping at School
- Sharing with Friends
- Teamwork
- Kindness
- Honesty
- Responsibility
- Self-Confidence
- Positive Thinking
- Personal Hygiene
- Healthy Food Choices
- Drinking Clean Water
- Exercise
- Good Sleeping Habits
- Keeping Surroundings Clean
- Saving Water
- Saving Electricity
- Protecting Plants
- Caring for Animals
- Road Safety Rules
- Traffic Signals
- Fire Safety (Basic)
- Emergency Awareness
- Stranger Safety
- Safe Touch and Unsafe Touch
- Managing Emotions
- Being Patient
- Respecting Public Places
- Digital Device Time Awareness
`,

    "Class 1": `
- Good Citizenship
- Respect for Diversity
- Respecting Elders
- Respecting Teachers
- Friendship
- Teamwork
- Leadership (Basic)
- Honesty
- Responsibility
- Self-Discipline
- Time Management (Basic)
- Personal Hygiene
- Healthy Lifestyle
- Balanced Daily Routine
- Exercise
- Emotional Awareness
- Expressing Feelings
- Managing Anger
- Helping Others
- Caring for Animals
- Caring for Nature
- Saving Water
- Saving Electricity
- Recycling
- Road Safety
- Public Property Care
- Queue Discipline
- Fire Safety
- Emergency Numbers (Basic)
- Safe Internet Awareness (Basic)
- Screen Time Balance
`,

    "Class 2": `
- Good Citizenship
- Respect for Rules
- Respect for Diversity
- Leadership Skills
- Teamwork
- Decision Making (Basic)
- Responsibility
- Honesty
- Empathy
- Compassion
- Gratitude
- Positive Thinking
- Self-Control
- Time Management
- Healthy Lifestyle
- Nutrition
- Physical Activity
- Mental Wellbeing
- Emotional Intelligence
- Conflict Resolution (Basic)
- Caring for the Environment
- Waste Segregation
- Recycling
- Saving Natural Resources
- Road Safety
- Public Safety
- Disaster Awareness (Basic)
- Fire Safety
- Cyber Safety (Basic)
- Responsible Screen Time
`,

    "Class 3": `
- Good Citizenship
- Rights and Responsibilities (Basic)
- Respect for Diversity
- Leadership
- Teamwork
- Decision Making
- Problem Solving
- Critical Thinking
- Honesty
- Integrity
- Responsibility
- Accountability
- Empathy
- Compassion
- Gratitude
- Self-Confidence
- Emotional Intelligence
- Managing Stress (Basic)
- Healthy Lifestyle
- Balanced Nutrition
- Physical Fitness
- Mental Wellbeing
- Environmental Responsibility
- Sustainable Living
- Recycling
- Water Conservation
- Energy Conservation
- Public Property Protection
- Road Safety
- Disaster Preparedness (Basic)
- Digital Citizenship
- Internet Safety
- Cyberbullying Awareness (Age Appropriate)
- Responsible Technology Use
`,
  },

  "Logical Reasoning": {
    "Nursery": `
- Same and Different
- Match Identical Objects
- Match Identical Pictures
- Find the Odd One Out
- Big and Small
- Tall and Short
- Long and Short
- More and Less
- Heavy and Light
- Inside and Outside
- Up and Down
- Left and Right (Basic)
- Near and Far
- Identify Colors
- Match Colors
- Identify Shapes
- Match Shapes
- Complete Simple Patterns
- Find the Missing Object
- Picture Matching
- Shadow Matching (Simple)
- Object Classification
- Animal Classification
- Fruit Classification
- Size Comparison
- Simple Visual Observation
- Picture Differences
- Simple Sequences
- Everyday Logic
`,

    "LKG": `
- Picture Patterns
- Shape Patterns
- Color Patterns
- Number Patterns (Basic)
- Complete the Pattern
- Find the Odd One Out
- Picture Classification
- Object Classification
- Animal Classification
- Fruit and Vegetable Classification
- Match Related Objects
- Picture Pairs
- Shadow Matching
- Mirror Image (Basic)
- Spot the Difference
- Visual Comparison
- Bigger and Smaller
- Longer and Shorter
- Heavier and Lighter
- Arrange by Size
- Arrange by Length
- Simple Sequencing
- What Comes Next?
- Missing Picture
- Position Words
- Everyday Reasoning
- Observation Skills
- Visual Memory
`,

    "UKG": `
- Picture Series
- Shape Series
- Number Series (Basic)
- Pattern Completion
- Missing Picture
- Missing Shape
- Missing Number
- Odd One Out
- Classification
- Grouping Objects
- Related Objects
- Picture Analogy
- Shape Analogy
- Shadow Matching
- Mirror Image (Basic)
- Direction Awareness
- Position Awareness
- Visual Comparison
- Arrange in Order
- Small to Big
- Short to Tall
- Sequencing Events
- Daily Routine Sequencing
- Find the Correct Path (Simple)
- Observation Skills
- Visual Reasoning
- Critical Observation
- Simple Problem Solving
`,

    "Class 1": `
- Picture Series
- Number Series
- Shape Series
- Alphabet Series (Basic)
- Complete the Pattern
- Missing Figure
- Missing Number
- Odd One Out
- Classification
- Grouping
- Analogy (Pictures)
- Analogy (Words)
- Direction Sense (Basic)
- Position and Order
- Ranking (Basic)
- Coding (Picture Based)
- Visual Reasoning
- Mirror Images
- Shadow Matching
- Embedded Shapes
- Identify Differences
- Sequencing
- Arrange Events
- Logical Comparison
- Problem Solving
- Everyday Reasoning
- Critical Thinking
- Observation Skills
- Simple Puzzle Solving
`,

    "Class 2": `
- Number Series
- Alphabet Series
- Picture Series
- Shape Series
- Pattern Recognition
- Missing Figure
- Missing Number
- Odd One Out
- Classification
- Analogies
- Coding and Decoding (Basic)
- Direction Sense
- Ranking
- Calendar Logic (Basic)
- Clock Logic (Basic)
- Mirror Images
- Water Images (Basic)
- Embedded Figures
- Figure Completion
- Paper Folding (Basic)
- Cube Recognition (Basic)
- Spatial Reasoning
- Sequencing
- Cause and Effect
- Logical Decisions
- Everyday Problem Solving
- Visual Reasoning
- Analytical Thinking
- Observation Skills
`,

    "Class 3": `
- Advanced Number Series
- Advanced Alphabet Series
- Mixed Series
- Pattern Recognition
- Missing Figure
- Figure Matrix
- Odd One Out
- Classification
- Analogies
- Coding and Decoding
- Direction Sense
- Blood Relations (Basic)
- Ranking
- Calendar
- Clock
- Mirror Images
- Water Images
- Embedded Figures
- Figure Completion
- Paper Folding
- Paper Cutting
- Cube and Dice (Basic)
- Spatial Visualization
- Logical Arrangement
- Sequencing
- Cause and Effect
- Decision Making
- Problem Solving
- Critical Thinking
- Analytical Reasoning
- Visual Intelligence
- Olympiad Reasoning
`,
  },

  "Computer Studies": {
    "Nursery": `
- Identify a Computer
- Identify a Laptop
- Identify a Tablet
- Identify a Mobile Phone
- Identify a Smart TV
- Identify a Keyboard
- Identify a Mouse
- Identify a Monitor
- Machines We Use Every Day
- Computer at Home
- Computer at School
- Learning with Computers
- Watching Educational Videos
- Listening to Rhymes on Computer
- Drawing on a Tablet
- Computer is an Electronic Machine
- Handle Devices Carefully
- Clean Hands Before Using Devices
- Sit Properly While Using a Computer
- Ask an Adult Before Using a Device
- Screen Time Awareness (Basic)
- Technology Around Us
`,

    "LKG": `
- Computer and Laptop
- Tablet and Mobile Phone
- Monitor
- Keyboard
- Mouse
- Speakers
- Printer (Recognition)
- Uses of a Computer
- Uses of a Tablet
- Uses of a Mobile Phone
- Learning Through Computers
- Educational Games
- Drawing on Computer
- Listening to Stories
- Watching Educational Videos
- Machines That Need Electricity
- Handle Devices Carefully
- Keep Devices Clean
- Correct Sitting Posture
- Ask Permission Before Using Devices
- Screen Time Balance
- Technology in Daily Life
`,

    "UKG": `
- What is a Computer?
- Parts of a Computer
- Monitor
- Keyboard
- Mouse
- CPU (Recognition)
- Speakers
- Printer
- Laptop
- Tablet
- Smart Phone
- Smart TV
- Input Devices (Basic)
- Output Devices (Basic)
- Uses of Computers
- Learning with Technology
- Educational Apps
- Drawing Using Computer
- Basic Mouse Click
- Correct Sitting Posture
- Computer Lab Rules
- Handle Devices Carefully
- Screen Time Awareness
- Digital Devices Around Us
- Technology in Everyday Life
`,

    "Class 1": `
- What is a Computer?
- Parts of a Computer
- Monitor
- CPU
- Keyboard
- Mouse
- Speakers
- Printer
- Laptop
- Tablet
- Desktop Computer
- Smart Phone
- Uses of Computers
- Uses of Mobile Phones
- Machines Around Us
- Input Devices (Basic)
- Output Devices (Basic)
- Start and Shut Down Computer (Basic)
- Computer Lab Rules
- Handle Devices Carefully
- Keep Computer Clean
- Do Not Eat Near Computer
- Correct Sitting Posture
- Basic Digital Etiquette
- Technology in Daily Life
`,

    "Class 2": `
- Revision of Computer Parts
- Input Devices
- Output Devices
- Storage Devices (Basic)
- Hardware (Basic)
- Software (Basic)
- Keyboard Keys
- Alphabet Keys
- Number Keys
- Enter Key
- Spacebar
- Backspace Key
- Mouse Click
- Double Click
- Drag and Drop (Basic)
- Desktop
- Icons
- Files
- Folders
- Paint Application
- Drawing with Paint
- Typing Practice
- Save a File (Basic)
- Open a File (Basic)
- Computer Lab Rules
- Internet (Introduction)
- Safe Use of Computer
- Screen Time Awareness
`,

    "Class 3": `
- Hardware
- Software
- Input Devices
- Output Devices
- Storage Devices
- CPU
- Memory (Basic)
- Keyboard Shortcuts (Basic)
- Mouse Operations
- Desktop
- Windows
- Icons
- Files
- Folders
- File Management (Basic)
- Paint Tools
- Word Processing (Basic)
- Typing Skills
- Internet
- Browser
- Website
- Search Engine (Basic)
- Email (Basic Awareness)
- Online Learning
- Digital Communication
- Password Safety
- Cyber Safety
- Personal Information Safety
- Good Digital Citizenship
- Responsible Internet Usage
- Technology in Everyday Life
`,
  },

};


// ======================================================
// SUBJECT / CLASS ALIASES
//
// The app may send slightly different labels, so we
// normalise before looking the syllabus up.
// ======================================================

const SUBJECT_ALIASES: Record<string, string> = {
  "bengali": "Bengali",
  "bangla": "Bengali",
  "maths": "Mathematics",
  "math": "Mathematics",
  "mathematics": "Mathematics",
  "english": "English",
  "science": "Science",
  "evs": "Science",
  "gk": "General Knowledge",
  "general knowledge": "General Knowledge",
  "life skills": "Life Skills & Values",
  "values": "Life Skills & Values",
  "life skills & values": "Life Skills & Values",
  "life skills and values": "Life Skills & Values",
  "logical reasoning": "Logical Reasoning",
  "reasoning": "Logical Reasoning",
  "computer": "Computer Studies",
  "computers": "Computer Studies",
  "computer studies": "Computer Studies"
};


const CLASS_ALIASES: Record<string, string> = {
  "nursery": "Nursery",
  "lkg": "LKG",
  "ukg": "UKG",
  "class 1": "Class 1",
  "class1": "Class 1",
  "1": "Class 1",
  "class 2": "Class 2",
  "class2": "Class 2",
  "2": "Class 2",
  "class 3": "Class 3",
  "class3": "Class 3",
  "3": "Class 3"
};


function normaliseSubject(
  value: string
): string | null {

  const key =
    value.trim().toLowerCase();

  return SUBJECT_ALIASES[key] ?? null;
}


function normaliseClassLevel(
  value: string
): string | null {

  const key =
    value.trim().toLowerCase();

  return CLASS_ALIASES[key] ?? null;
}


// ======================================================
// SYLLABUS LOOKUP
// ======================================================

function getSyllabus(
  subject: string,
  classLevel: string
): string | null {

  const s = normaliseSubject(subject);
  const c = normaliseClassLevel(classLevel);

  if (!s || !c) {
    return null;
  }

  return syllabus[s]?.[c] ?? null;
}


function availableSubjects(): string[] {
  return Object.keys(syllabus);
}


function availableClassLevels(): string[] {
  return [
    "Nursery",
    "LKG",
    "UKG",
    "Class 1",
    "Class 2",
    "Class 3"
  ];
}
export { getSyllabus, normaliseSubject, normaliseClassLevel, availableSubjects, availableClassLevels };
