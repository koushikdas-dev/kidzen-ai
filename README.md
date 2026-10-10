# Kidzen Students AI Tutor API — 2.1

Cloudflare Worker for Nursery, LKG, UKG, Class 1 and Class 2, with English/Hindi/Bengali text, spoken questions, photo questions, checked audio replies and occasional reusable illustrations. This updates the previous tutor project; old image-generation/marketing/logo routes remain removed.

## New features

- Spoken questions: upload a short WAV recording, transcribe once, and run the same child-safety pipeline as typed questions. Raw transcription is not returned or logged, because it can contain harmful/private words.
- Photo questions: upload JPEG/PNG with a typed question, a spoken question, or no question (default: describe the photo). The photo is moderated first; both tutor and independent reviewer see it. Responses explain visible objects simply and admit uncertainty. Worksheet help uses simple steps, but low-detail vision can miss small text: ask for a clearer crop rather than trust a guessed answer.
- Attractive explanations: short familiar examples, a gentle optional follow-up and one suitable curated illustration. Six reusable visual topics: sky, plant, five counting dots, circle/square/triangle shapes, rain, teeth. Maximum three illustrated replies per account/day; `visual_mode:none` disables them. No per-answer image-generation calls or fees. These are SVG illustrations, not newly AI-generated images or copies of uploaded photos.
- Text + audio: return checked text and a signed, account-bound ten-minute speech token. Flutter displays text immediately, then calls `/v1/tutor/speech` for MP3. The speech API accepts only the signed checked answer, never arbitrary text. Speech failure leaves the text intact. Local replay avoids a second paid speech call.

The voice is a configurable, AI-generated built-in voice with gentle, cheerful storybook delivery. Default: `coral`, model `gpt-4o-mini-tts`. OpenAI does not guarantee a dedicated child voice; this is a child-friendly synthetic voice, not a real child recording/clone. Audition `coral`, `marin`, `nova` or `shimmer` with your target languages. Voices are currently optimized for English; Hindi/Bengali quality must be tested. No extra pitch processing is enabled by default. Use a clear AI-generated voice disclosure.

## Safety and privacy

Every normal answer runs input moderation, structured tutor generation, output checks/moderation and an independent age-safety review before release. Both answer and follow-up are checked. Input flags inform safe, truthful sensitive-topic explanations; high-risk disclosures get curated trusted-adult guidance. Photo flags conservatively replace the response; no flagged photo reaches tutor generation. Recognized danger disclosures get local guidance before further model calls. All user/history/image text is untrusted data, including instructions printed on worksheets. No streaming of unchecked generated text.

The policy avoids profanity, insults, adult/sexualized content, graphic descriptions, harmful instructions, shaming, secrecy or dependency. Simple factual body-safety and nonsexual anatomy are allowed so children can seek help. No AI system guarantees perfect safety, factual correctness or transcription accuracy. The supplemental word/private-data regexes are incomplete; live evaluation and a caregiver reporting process remain required.

No conversation/media database, R2 bucket or chat logging is used. Uploads are bounded and passed in memory; WAV metadata is removed, JPEG APP1/APP13/comments and PNG text/EXIF metadata are stripped. This is not full media sanitization or a complete private-data detector: faces, school names, addresses and written details can still be visible. App capture should crop to the object/worksheet, avoid people/IDs, and provide a caregiver-controlled safe upload/reporting process. Do not submit known/suspected CSAM to OpenAI moderation; use your dedicated child-protection process. OpenAI's image-input retention exceptions can apply to suspected CSAM even under ZDR.

`needs_adult_help:true` means show an actual trusted-adult help card and stop ordinary follow-ups. It does not notify anybody or call emergency services. Never display internal error codes, rejected text or moderation details to children. Implement a visible parent-facing report/help action and real safeguarding response channel in your app.

## Required deployment setup

The app/backend must verify guardian consent and age access before minting a token. The signed `guardian_consent` claim is an assertion by your trusted backend, not an implementation of consent collection or age assurance. Token renewal must stop when consent is withdrawn; issued tokens expire within at most an hour (helper default: fifteen minutes).

OpenAI requires Zero Data Retention before processing personal data from children under 13/the applicable age of digital consent. Chat text, voices and photos may contain personal data. Obtain confirmation for the exact API project and relevant text/audio/image endpoints. `store:false` is included on Responses calls but does not activate ZDR or disable default abuse-monitoring retention.

The configuration uses manual operator attestations, not automatic account checks:

| Setting | Default | Enable only after |
| --- | --- | --- |
| `OPENAI_ZDR_CONFIRMED` | false | ZDR confirmed for your OpenAI project and selected features |
| `OPENAI_AUDIO_CONFIRMED` | false | Voice recording consent/privacy and audio endpoint retention setup verified |
| `PHOTO_UPLOAD_SAFEGUARDS_CONFIRMED` | false | Safe uploads, caregiver guidance and reporting process implemented |

Disabled features return setup errors before paid calls. Leave them disabled until the setup is complete. Disabling audio removes speech tokens from all replies but leaves text usable. Config exposes feature flags; they indicate configured attestations, not tested readiness.

### Installation

Node.js 22+ and Cloudflare account required:

```bash
npm ci
npm test
npm run check
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TUTOR_JWT_SECRET
```

Use a random 32+ character signing secret shared ONLY by this Worker and your trusted backend. Never put OpenAI/signing secrets in Flutter. Your old `GPT_API` key name is supported as fallback, but Worker secrets do not automatically transfer to the separate tutor Worker.

Edit `wrangler.toml`: actual allowed web origins, token issuer/audience, model IDs accessible in your OpenAI project, and verified readiness settings. `TUTOR_MODEL`/`SAFETY_MODEL` must support Responses + Structured Outputs + image inputs for photo use. Defaults remain `gpt-6-astra`; confirm account access. Speech/transcription use `gpt-4o-mini-tts`/`gpt-4o-mini-transcribe`. TTS voice is configured by the server, not the child. No fallback bypasses safety checks.

```bash
npm run deploy
```

Worker name remains `kidzen-students-ai-tutor`, version 2.1. Existing `TutorLimiter` binding/migration remain; no new migration is needed for this update. SQLite Durable Objects store only opaque-account counters. Keep the migration history intact. Works with the Cloudflare Free plan within its quotas. Observability remains disabled; also ensure your mobile/proxy/APM tools do not record child content.

For local development, copy `.dev.vars.example` to `.dev.vars`, configure secrets, run `npm run dev`. Readiness gates still apply. Offline unit tests use mocks and need no actual key. The lockfile retains the archive's Wrangler dependency graph with Hugging Face removed; executable dependencies and a real Wrangler staging build require your development environment.

## API reference

All tutor endpoints require `Authorization: Bearer <parent-authorized JWT>`, except public health and curated SVG assets. CORS allowlists are not authentication; native apps without Origin are accepted. Browser origins must match `ALLOWED_ORIGINS`.

| Method | Path | Content / result |
| --- | --- | --- |
| GET | `/health` | Version/liveness, not provider readiness |
| GET | `/v1/tutor/config` | Grades, languages, input limits, feature flags and AI disclosure |
| GET | `/v1/tutor/suggestions?language=en` | Curated starter questions |
| POST | `/v1/tutor/chat` or `/chat` | JSON typed question → checked text, optional visual and speech token |
| POST | `/v1/tutor/voice-chat` | Multipart audio → checked text, optional visual and speech token |
| POST | `/v1/tutor/photo-chat` | Multipart image + optional audio or text question → checked text, visual and speech token |
| POST | `/v1/tutor/speech` | JSON signed speech token → binary `audio/mpeg` |
| GET | `/v1/tutor/visuals/{id}.svg` | Public, fixed illustrations; no private content |

The old `/generate`, `/ideas`, `/upload-reference`, `/upload-brand-logo`, `/delete-brand-logo` and `/brand-logo` routes return 404. Existing text tutor consumers can continue to read `data.answer`; new response fields are additive.

### Typed question

```json
{"message":"Why is the sky blue?","grade":"class_1","language":"en","visual_mode":"auto","history":[]}
```

`message` required, up to 1000 JavaScript string characters. Defaults: `grade:nursery`, `language:en`, `visual_mode:auto`, `history:[]`. Grades: `nursery`, `lkg`, `ukg`, `class_1`, `class_2`. Languages: `en`, `hi`, `bn`. At most eight history items, each `{role:user|assistant, content:string}` up to 1000 characters. Treat them as stateless context; history is not saved by the Worker. Use only checked replies and clear context after adult-help/privacy reminders. Unknown fields and client model/system-prompt overrides are rejected. JSON body limit: 16 KiB.

### Voice question

```bash
curl https://YOUR_WORKER.workers.dev/v1/tutor/voice-chat \
  -H 'Authorization: Bearer YOUR_SHORT_LIVED_TOKEN' \
  -F 'audio=@question.wav;type=audio/wav' \
  -F 'grade=nursery' -F 'language=en' -F 'visual_mode=auto'
```

WAV must be mono, 16 kHz, PCM16, nonempty, up to 45 seconds. The Worker validates actual format/data duration, not a client-provided duration. `record` in Flutter should use those settings and stop at forty seconds. Short, clear recording works better for young children; do not invent a question when transcription is empty or fails. Voice route does not accept `message` or `image`.

### Photo question

```bash
curl https://YOUR_WORKER.workers.dev/v1/tutor/photo-chat \
  -H 'Authorization: Bearer YOUR_SHORT_LIVED_TOKEN' \
  -F 'image=@plant.jpg;type=image/jpeg' \
  -F 'message=What is this plant?' -F 'grade=ukg' -F 'language=en'
```

JPEG/PNG only, one image, up to 2 MiB and 16 megapixels, at most 8192 pixels per dimension. Animated PNG rejected. Multipart total body cap: 4 MiB. No remote URLs (avoids untrusted URL fetching). Image format parsing/metadata stripping is not a full image decoder; malformed images can still fail at the provider.

Omit `message` to describe the photo, or supply `audio=@question.wav` instead of `message`. Typed and spoken questions together are rejected. Optional fields: grade, language, visual_mode, history (JSON string). Reject duplicate or unknown fields. Compress/crop to about 1024px JPEG before upload. Vision uses `detail:low`; actual token cost depends on the selected model, and low is not guaranteed cheaper for every model. Photo moderation plus two vision model calls are intentional safety overhead.

### Checked text response

```json
{
  "success": true,
  "request_id": "generated-uuid",
  "data": {
    "answer": "Sunlight has many colours. Air spreads the blue light around the sky.",
    "follow_up": "Can you spot a cloud?",
    "needs_adult_help": false,
    "grade": "class_1", "language": "en", "status": "answered",
    "visual": {"id":"sky","type":"illustration","url":"/v1/tutor/visuals/sky.svg","alt":"Sunlight and a blue sky"},
    "speech": {"token":"SIGNED_CHECKED_ANSWER_TOKEN","endpoint":"/v1/tutor/speech","format":"mp3","expires_in_seconds":600,"disclosure":"AI-generated voice"}
  }
}
```

Illustrative response, not a live-generated answer. `visual` and `speech` may be null. Render text as plain text and SVG from the provided fixed route. Do not render raw model HTML. Status: `answered`, `safe_alternative`, `adult_help`, `privacy_reminder`; failures can return curated `data.answer` with `unavailable` and HTTP 503. A safe alternative is displayable content, not necessarily a detailed answer to the original question.

### Audio of that answer

```bash
curl https://YOUR_WORKER.workers.dev/v1/tutor/speech \
  -H 'Authorization: Bearer YOUR_SHORT_LIVED_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{"speech_token":"SIGNED_CHECKED_ANSWER_TOKEN"}' --output reply.mp3
```

Speech tokens are signed, account-bound, expire after ten minutes, and contain the already checked answer. They are not encrypted: do not log them or put them in URL query strings. They cannot be substituted with the auth JWT or altered to speak arbitrary text. Download once and replay locally for the session. On speech failure show/keep the text; optionally use the device TTS on that checked answer. No token regenerating endpoint exists—after expiry use your locally cached speech/device TTS rather than asking the tutor again solely to renew audio.

### Authentication / quotas / errors

HS256 JWT header `{alg:HS256,typ:JWT}`, signed payload fields `iss`, `aud`, `sub`, `iat`, `exp`, `guardian_consent:true`. Issuer/audience must match configuration. `sub`: stable opaque identifier, 16–128 letters/digits/underscores/hyphens; never child name/email. Numeric timestamps in Unix seconds, token lifetime ≤3600 seconds. Helper `scripts/mint-token.mjs` reads signing secret and consent attestation from trusted-server environment, and prints a fifteen-minute test token. Production issuer uses authenticated account + verified consent record; client must never choose a new account ID to bypass limits. Revocation stops renewal; existing tokens last to expiry.

Limits per opaque account, fixed UTC windows:

| Budget | Limit |
| --- | --- |
| All paid endpoint requests combined | 6/minute, 100/day |
| Voice-chat requests | 30/day |
| Photo-chat requests (may include audio) | 10/day |
| Speech requests | 20/day |
| Illustrated answers | 3/day |

Text+speech is two requests. Failed/rejected attempts consume request budgets. Illustrations are selected only after the answer passes checks; depleted/unavailable illustration quota does not discard the answer. Quotas are enforced atomically in Durable Objects across Worker instances. Counters are removed after roughly a day of inactivity; infrastructure backup/PITR retention may last longer. Set provider/account-wide spend alerts too.

Errors: 400 validation, 401 token, 403 origin, 404 route, 405 method, 413 size, 415 format, 422 unclear/long transcription, 429 quota, 503 setup/provider unavailable. Rate rejection includes `Retry-After:60`; a depleted daily quota does not reset after sixty seconds. Read non-2xx JSON bodies. Speech success is binary; speech errors are JSON, so check HTTP status/content type before playing. Each response has `X-Request-Id`.

## Validation

37 offline tests pass: previous safety/auth/request tests plus audio transcription routing, signed speech/tampering/account binding, TTS failure with usable text, photo moderation and two vision calls, spoken-photo questions, media configuration gates, visual opt-out/quota/public assets, WAV format/duration checks, PNG metadata stripping and modality counters.

No live OpenAI model/voice evaluation, account capability validation, actual Wrangler/Cloudflare deployment or Flutter analysis/build has been performed. Flutter SDK is unavailable in this workspace. The Dart files are integration samples, not changes to your full app (which was not attached). Run a staging deployment and real-device tests before child access. Offline mocks validate control flow, not real-model child safety, child speech recognition, image accuracy or audible voice quality.

Use `evals/cases.json` plus spoken/photo cases from `flutter_integration/README.md`; test accents, quiet/noisy recordings, Hindi/Bengali, unclear worksheets, unsafe image prompts and multi-turn disclosures using synthetic data. Audition voice samples with educators/parents. Re-evaluate after changing prompts/models/voices.

## Official references

- https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance
- https://developers.openai.com/api/docs/guides/your-data
- https://developers.openai.com/api/docs/guides/moderation
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/docs/guides/text-to-speech
- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.cloudflare.com/changelog/post/2026-07-09-restrict-new-kv-backed-namespaces/
