# Kidzen Tutor API v2.3 — UID-only app flow

Google login → premium membership OR enough XP → ask the tutor → checked text → optional audio/illustration.

Google login, store purchases and the Firebase Realtime Database wallet remain in your Flutter app. Cloudflare provides AI only. No separate auth backend, custom login JWT, token minting, issuer/audience, or login-token expiry is required.

## Deploy and test

```bash
npm ci
npm test
npx wrangler secret put OPENAI_API_KEY
npm run deploy
```

Your OpenAI API key stays only in Cloudflare, as a secret named OPENAI_API_KEY (GPT_API is a legacy fallback). No client app key, JWT or token-issuing backend is used. A separate TUTOR_APP_KEY stored in Cloudflare has no role in this mode and can be removed.

Existing Worker name, Durable Object binding and migration remain. Configure allowed web origins and accessible model IDs. Child-data/audio/photo readiness settings remain as documented below.

Import both JSON files from postman/, select Kidzen_Tutor_UID_Only and fill:

| Variable | Value |
| --- | --- |
| base_url | Your deployed Worker URL |
| user_id | postman-test-user, or your Google/Firebase UID |

Start Health → Configuration → Text question → Audio answer. No access_token needed. Pick WAV/image files in Body > form-data for media requests. This package contains the updated33-request collection; discard the previous JWT-based collection/environment.

Tutor calls send only:

```http
X-User-Id: YOUR_GOOGLE_OR_FIREBASE_UID
```

User ID must use1–128letters/digits/underscores/hyphens, no email/name. It is hashed before naming stored counters and is never sent to OpenAI. Native apps need no Origin header. Web origins must match ALLOWED_ORIGINS. Public health/SVG routes need no headers.

## Flutter premium / XP flow

1. Keep your current Google login.
2. Refresh your existing local/store premium state and XP balance after purchase/restore.
3. Premium user: submit a question directly, with no XP deduction.
4. Other logged-in user: atomically reserve the configured XP cost through your existing wallet; if insufficient, show your premium/XP purchase screen and do not call Cloudflare.
5. Submit the text/voice/photo question once. Prevent repeated taps while it runs.
6. Finalize the reservation for status answered; refund for unavailable/privacy/safety/adult-help replies or a request failure. Persist/reconcile pending reservations if the app closes during a request.
7. Show text immediately. Optional audio reads that answer. Listen-again/illustration fetches do not deduct XP again.

flutter_integration/ contains updated API client, reply card, media controller and a TutorAccessController wrapper. Hook the wrapper callbacks to your actual login/purchase/Realtime Database services. No full Flutter project was attached, so these are integration samples, not edits to your existing store/wallet implementation. Your own Google/Firebase/Store settings remain unchanged by the Worker.

The reserve callback must perform an atomic debit/reservation, not read-and-subtract. commit finalizes an already reserved debit (must not deduct twice); refund reverses it exactly once. Track purchase transaction IDs so restored/repeated store events do not credit XP twice. Do not consume XP or refund automatically when the HTTP client retries; the sample makes no automatic paid-request retries. Your backend does not implement request idempotency, so a retry is a new model call.

## Scope of this simple access mode

The Worker accepts a client-supplied Firebase UID without verifying Firebase authentication. A UID is an identifier, not proof that the caller owns that account. No store receipt, premium status or XP balance is verified by Cloudflare, and the Worker does not write Firebase. The app controls payment access as requested. There is no caller authentication at this API. Client-supplied IDs/premium/XP checks can be forged; direct calls may bypass login and purchases. User-ID quotas are best effort and can be bypassed by changing IDs. Set OpenAI account/project spend controls and alerts. Future stronger enforcement can use existing Firebase identity/entitlement verification, but it is not required or implemented here.

Google login and a purchase are not guardian consent. Keep your caregiver consent/age/privacy/help flow in the existing app; custom server-issued consent JWTs were removed.

## Retained child-data setup

The following are readiness attestations, independent of login/payment:

- OPENAI_ZDR_CONFIRMED=false by default: set true only after OpenAI confirms the exact API project retention arrangement for child personal data.
- OPENAI_AUDIO_CONFIRMED=false: set true after voice consent/privacy and audio endpoint setup.
- PHOTO_UPLOAD_SAFEGUARDS_CONFIRMED=false: set true after safe uploads/caregiver guidance/reporting are implemented.

Responses calls use store:false, but that does not activate ZDR. Child voices/photos/text may contain personal data. No chat/media/transcription is stored by this Worker. Metadata stripping is supplemental: visible faces/addresses/school details can remain. Do not send known/suspected CSAM to moderation; maintain dedicated child-protection handling. Image retention exceptions can apply even with ZDR.

## Endpoints

| Method | Path | Result |
| --- | --- | --- |
| GET | /health | Public version/liveness |
| GET | /v1/tutor/config | Grades, languages, media flags/limits |
| GET | /v1/tutor/suggestions?language=en | Safe starter questions |
| POST | /v1/tutor/chat or /chat | Typed question → checked reply |
| POST | /v1/tutor/voice-chat | WAV question → checked reply |
| POST | /v1/tutor/photo-chat | Photo with optional text/WAV → checked reply |
| POST | /v1/tutor/speech | Automatic checked-answer receipt → MP3 |
| GET | /v1/tutor/visuals/{id}.svg | Public fixed illustration |

Old image/marketing/logo routes return404.

### Text example

```bash
curl https://YOUR_WORKER.workers.dev/v1/tutor/chat \
  -H 'X-User-Id: postman-test-user' \
  -H 'Content-Type: application/json' \
  --data '{"message":"Why is the sky blue?","grade":"nursery","language":"en","visual_mode":"auto","history":[]}'
```

Grades: nursery,lkg,ukg,class_1,class_2. Languages: en,hi,bn. Defaults: nursery/en/auto/empty history. Message ≤1000JavaScript characters, eight history messages max (user/assistant content, ≤1000each), JSON body≤16KiB. Unknown fields rejected, including client model/system-policy overrides.

### Media

Use multipart with fields grade/language/visual_mode and optional history(JSONstring). voice-chat: audio file only, no message/image. photo-chat: image file plus optional message OR audio; omit both to describe the photo. Duplicate/unknown fields rejected. Do not manually set multipart Content-Type.

Audio: mono16kHzPCM16WAV, nonempty, ≤45seconds; actual duration/header checked and metadata stripped. Photo: JPEG/PNG≤2MiB,16megapixels maximum,8192pixels per dimension, nonanimated. Multipart body≤4MiB. Common JPEG/PNG metadata removed; this is not a complete decoder or private-data detector. Use compressed/cropped1024px images and do not upload remote URLs. Low-detail vision may miss worksheet text; ask for a clearer crop rather than relying on guessed answers.

### Reply and audio

Reply fields under data: answer,follow_up,needs_adult_help,grade,language,status,visual(nullable),speech(nullable). Success statuses: answered,safe_alternative,adult_help,privacy_reminder. Failures may include curated text with unavailable/HTTP503. Render plain text only.

With audio enabled, speech.token is created automatically by Cloudflare and captured by Postman. This is a checked-answer receipt, not a login token; no manual generation or extra signing secret. Send {"speech_token":"RECEIPT_FROM_REPLY"} to /v1/tutor/speech with the same user ID. The receipt expires after10minutes, is not encrypted and must not be logged. A server-only signing key is domain-separated from the OpenAI key; rotating that key invalidates pending receipts. Do not put OpenAI credentials into the app. Speech returns audio/mpeg on success and JSON errors otherwise.

Voice is configurable cheerful/gentle synthetic storybook delivery; not a guaranteed real/dedicated child voice. Default coral/gpt-4o-mini-tts; audition English/Hindi/Bengali. Clear AI-generated voice disclosure required. Download once, replay locally, retain text if audio fails. Phone/device TTS of the checked answer is a lower-cost alternative with variable voice quality. Speech/illustrations do not consume XP again in the Flutter wrapper.

## Safety and cost

Input moderation, structured tutor policy, output checks/moderation and independent age-safety review remain mandatory before release. Both reply and follow-up are checked. Photos are moderated and visible to both tutor/reviewer. No unchecked generated text streaming; high-risk disclosures get trusted-adult guidance. No system guarantees perfect factual accuracy/safety/transcription. Show caregiver help when needs_adult_help=true; it does not contact anybody automatically. Review your real safeguarding/report process before child access.

Six reusable illustrations (sky,plant,counting five dots,shapes,rain,teeth), optional, one per reply, three/day. No image-generation requests. visual_mode:none disables visuals. Normal chat: two text model calls + two moderation calls; audio question adds transcription, speech playback adds TTS, photo adds image moderation and vision inputs. Defaults use configured models; no safety-bypassing fallback.

Per supplied user-ID quotas:6paid requests/minute,100/day combined; voice30/day,photo10/day,speech20/day;3illustrated answers/day. Failed/rejected calls consume request quota. Daily windows UTC. Counters expire about a day after inactivity; infrastructure backup retention may outlast deletion. These limits control ordinary app usage, not malicious client impersonation.

Errors:400validation/UID,401invalid speech receipt,403origin,404route,405method,413size,415format,422unclear transcript,429quota,503configuration/provider. Retry-After60 does not reset a depleted daily budget. Use request timeout150seconds for voice/photo. Do not auto-retry paid requests.

## Validation

37 offline API tests pass with UID-only access, child-safety routing, audio receipt binding, media checks, quotas, and failures. Live OpenAI/Cloudflare deployment, actual Postman UI import, audible speech evaluation, Flutter analysis/build and your store/Firebase wallet integration have not been performed. Flutter SDK is unavailable here. Use supplied synthetic evaluation cases and real-device staging checks before launch.
