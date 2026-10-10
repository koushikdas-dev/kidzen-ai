# Flutter integration — simple Google login + premium/XP flow

Use your existing Google login and store purchase flow. Cloudflare does not need
an auth backend or login token. Copy the four lib/ samples into your app:
- tutor_api.dart: app-key/UID requests, text, voice/photo uploads and audio.
- tutor_access_controller.dart: login/premium/XP gate callbacks.
- tutor_media_controller.dart: WAV recording, camera JPEG compression.
- tutor_reply_card.dart: checked text, SVG, cached local MP3, caregiver-help action.

Install packages compatible with your app:
flutter pub add http http_parser record image_picker flutter_image_compress just_audio path_provider flutter_svg

Configure the API:

```dart
final api = TutorApi(
  baseUrl: Uri.parse('https://YOUR_WORKER.workers.dev'),
  appKey: const String.fromEnvironment('TUTOR_APP_KEY'),
  userIdProvider: () => yourExistingLogin.currentUserId ?? '',
);
```

Build example:
flutter build apk --dart-define=TUTOR_APP_KEY=YOUR_APP_KEY

The app key must match Cloudflare TUTOR_APP_KEY; it is extractable from the app.
It is NOT an OpenAI key or secure purchase proof. Google/Firebase UID is used only
for quota grouping; it is not verified by the Worker. For Firebase Auth use your
existing currentUser.uid; for Google-only login use the stable Google user ID.
Do not send email/name as the ID. No getIdToken() call or custom JWT is required.

Wire the gate to YOUR existing store/wallet services:

```dart
final access = TutorAccessController(
  isLoggedIn: () => yourExistingLogin.currentUserId != null,
  hasPremium: () => yourStoreService.hasActivePremium(),
  reserveXp: (amount) => yourWallet.reserveXp(amount),
  commitXp: (reservationId) => yourWallet.finalizeReservation(reservationId),
  refundXp: (reservationId) => yourWallet.refundReservation(reservationId),
  xpPerQuestion: 1, // Your product decision; adjust here.
);

final reply = await access.ask(() => api.askText(
  'How do plants grow?', grade: 'ukg', language: 'en',
));
```

The named services above are adapter placeholders, not new backend services.
Map them to existing Google login/store-purchase state/Realtime Database wallet.
Premium: no XP reservation. Otherwise reserve atomically before the question;
insufficient XP throws premium_or_xp_required before Cloudflare is called.
The sample finalizes XP only for status answered; safety/adult-help/privacy/outage
or API failures refund. reserve must atomically debit/reserve; commit must not
deduct again. Finalize/refund must be idempotent, with pending reservations saved
and reconciled on app restart. Your Firebase rules/local store checks govern this
client wallet; no server receipt/XP validation has been added. Do not credit XP
twice from repeated/restored purchase events. Keep the controller shared during
the session to prevent overlapping questions. Do not silently retry paid calls.
If settlement fails, reconcile the saved reservation before retrying a question.

Voice and photo questions use the SAME gate:

```dart
final reply = await access.ask(() => api.askMedia(
  wav: recordedWav, photo: capturedPhoto, grade: 'nursery', language: 'en',
));
```

Pass only the inputs you have: wav for spoken question; photo alone for describe;
photo+wav for spoken photo; photo+question text for typed photo. Do not combine
wav and text. Delete temporary files in finally after upload. Do not reserve XP
until the child finishes recording/selecting the photo. Listen-again and SVG
fetches occur outside access.ask and do not charge XP again.

API exceptions: login_required → existing Google login; premium_or_xp_required →
existing premium/XP purchase screen; question_in_progress → keep loading state;
other errors → friendly localized message. Never expose internal codes to children.

Show checked text first. Use TutorReplyCard(key:ValueKey(reply.requestId),...)
with localized listen/help/error/AI-generated voice labels. The card fetches the
automatic speech receipt on first Listen and replays its local file afterward;
no auth-token generation. Keep reply text when audio fails. For low cost use
optional device TTS to read reply.answer rather than paying server TTS. A cheerful
storybook voice is configured server-side; actual child voice is not guaranteed.

Media setup:
- record: AudioEncoder.wav, sampleRate16000,numChannels1; controller stops40secs
  before the server's45sec limit. Test actual device output/resample if needed.
- Android INTERNET + RECORD_AUDIO permissions. Follow each plugin setup; current
  image_picker requires Android24+/iOS13+, other packages may require more.
- iOS NSMicrophoneUsageDescription,NSCameraUsageDescription and applicable
  NSPhotoLibraryUsageDescription with clear purpose strings.
- Implement screen lifecycle observer: cancel recording on inactive/background/
  navigation, stop audio before recording, disable repeated taps, guard mounted
  updates and dispose controller/client. No background recording/auto-submit.
- The returned WAV/photo file is caller-owned: delete after upload in finally.
  Camera source is deleted after compression; EXIF is stripped. Avoid faces,
  addresses/schoolIDs; metadata removal cannot remove visible private details.
- Handle image_picker lost-data recovery on Android per plugin guidance.
- Use HTTPS, caregiver consent/help/reporting and an AI/AI-voice disclosure.
  Google login or IAP alone is not guardian consent.
- Clear speech/session history and stale temporary kidzen-tutor-* directories
  after session/disposal and on next startup after a crash.

These are integration samples; your complete Flutter app/store/wallet project
was not attached. No real-device build/analyzer/store/Firebase test was performed.
Test purchases/restores/XP atomicity, interruptions, media format, repeated taps,
network failures, voice quality in all three languages and caregiver-help flow.
