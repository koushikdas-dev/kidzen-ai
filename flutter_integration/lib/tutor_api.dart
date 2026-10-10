// Android/iOS sample. OpenAI key stays on Cloudflare; app key is extractable.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

class TutorReply {
  final String requestId, answer, followUp, language, status;
  final bool needsAdultHelp;
  final String? speechToken, visualPath, visualAlt;
  const TutorReply({required this.requestId, required this.answer,
    required this.followUp, required this.language, required this.status,
    required this.needsAdultHelp, this.speechToken, this.visualPath, this.visualAlt});
  factory TutorReply.fromJson(Map<String, dynamic> json) {
    final data = json['data'] as Map<String, dynamic>;
    final speech = data['speech'] as Map<String, dynamic>?;
    final visual = data['visual'] as Map<String, dynamic>?;
    return TutorReply(requestId: json['request_id'] as String? ?? '',
      answer: data['answer'] as String, followUp: data['follow_up'] as String? ?? '',
      language: data['language'] as String? ?? 'en', status: data['status'] as String? ?? 'unavailable',
      needsAdultHelp: data['needs_adult_help'] as bool? ?? false,
      speechToken: speech?['token'] as String?, visualPath: visual?['url'] as String?,
      visualAlt: visual?['alt'] as String?);
  }
}
class TutorApiException implements Exception {
  final String code;
  final int status;
  const TutorApiException(this.code, this.status);
  @override String toString() => 'TutorApiException($code, $status)';
}
class TutorApi {
  final Uri baseUrl;
  final String appKey;
  // Your existing logged-in Google/Firebase user ID, used for quota grouping.
  final String Function() userIdProvider;
  final http.Client _client = http.Client();
  TutorApi({required this.baseUrl, required this.appKey, required this.userIdProvider});
  Uri endpoint(String path) => baseUrl.resolve(path);
  Future<Map<String, String>> _headers() async {
    final uid = userIdProvider();
    if (uid.isEmpty) throw const TutorApiException('login_required', 401);
    return {'X-App-Key': appKey, 'X-User-Id': uid};
  }
  TutorReply _decode(http.Response response) {
    final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    // Show curated outage text, never a machine error code to a child.
    if (body['data'] is Map && (body['data'] as Map)['answer'] is String) {
      return TutorReply.fromJson(body);
    }
    throw TutorApiException(body['error'] as String? ?? 'request_failed', response.statusCode);
  }
  Future<TutorReply> askText(String question, {String grade = 'nursery', String language = 'en',
    bool visuals = true, List<Map<String, String>> history = const []}) async {
    final response = await _client.post(endpoint('/v1/tutor/chat'),
      headers: {...await _headers(), 'Content-Type': 'application/json'},
      body: jsonEncode({'message': question, 'grade': grade, 'language': language,
        'visual_mode': visuals ? 'auto' : 'none', 'history': history})).timeout(const Duration(seconds: 130));
    return _decode(response);
  }
  // File must be mono, 16 kHz, PCM16 WAV. Photo must be stripped/compressed JPEG.
  Future<TutorReply> askMedia({File? wav, File? photo, String? question,
    String grade = 'nursery', String language = 'en', bool visuals = true,
    List<Map<String, String>> history = const []}) async {
    if (wav == null && photo == null) throw ArgumentError('Provide audio or photo.');
    if (wav != null && question != null && question.trim().isNotEmpty) throw ArgumentError('Choose audio or text.');
    final request = http.MultipartRequest('POST', endpoint(photo != null ? '/v1/tutor/photo-chat' : '/v1/tutor/voice-chat'));
    request.headers.addAll(await _headers());
    request.fields.addAll({'grade': grade, 'language': language,
      'visual_mode': visuals ? 'auto' : 'none', 'history': jsonEncode(history)});
    if (question != null && wav == null) request.fields['message'] = question;
    if (wav != null) request.files.add(await http.MultipartFile.fromPath('audio', wav.path, contentType: MediaType('audio', 'wav')));
    if (photo != null) request.files.add(await http.MultipartFile.fromPath('image', photo.path, contentType: MediaType('image', 'jpeg')));
    final response = await (() async => http.Response.fromStream(await _client.send(request)))().timeout(const Duration(seconds: 150));
    return _decode(response);
  }
  Future<Uint8List> fetchSpeech(TutorReply reply) async {
    if (reply.speechToken == null) throw const TutorApiException('audio_not_available', 503);
    final response = await _client.post(endpoint('/v1/tutor/speech'),
      headers: {...await _headers(), 'Content-Type': 'application/json'},
      body: jsonEncode({'speech_token': reply.speechToken})).timeout(const Duration(seconds: 35));
    if (response.statusCode != 200) {
      final body = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      throw TutorApiException(body['error'] as String? ?? 'speech_unavailable', response.statusCode);
    }
    if (!(response.headers['content-type'] ?? '').startsWith('audio/mpeg')) {
      throw const TutorApiException('unexpected_audio_format', 502);
    }
    return response.bodyBytes;
  }
  void dispose() => _client.close();
}
