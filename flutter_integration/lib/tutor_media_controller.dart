// Native Android/iOS sample. The screen must stop/cancel on app backgrounding.
import 'dart:async';
import 'dart:io';
import 'package:record/record.dart';
import 'package:image_picker/image_picker.dart';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'package:path_provider/path_provider.dart';

class TutorMediaController {
  final AudioRecorder _recorder = AudioRecorder();
  final ImagePicker _picker = ImagePicker();
  Timer? _timer;
  String? _recordingPath;
  bool _recording = false;
  bool _disposed = false;
  Future<void> startRecording({required Future<void> Function(File wav) onTimeLimit}) async {
    if (_disposed || _recording) return;
    if (!await _recorder.hasPermission()) throw StateError('Microphone permission is needed.');
    final directory = await getTemporaryDirectory();
    _recordingPath = '${directory.path}/kidzen-question-${DateTime.now().microsecondsSinceEpoch}.wav';
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.wav, sampleRate: 16000, numChannels: 1), path: _recordingPath!);
    _recording = true;
    // 40 seconds leaves a buffer below the server's strict 45 second limit.
    _timer = Timer(const Duration(seconds: 40), () async {
      final file = await stopRecording();
      if (!_disposed && file != null) await onTimeLimit(file);
    });
  }
  Future<File?> stopRecording() async {
    _timer?.cancel(); _timer = null;
    if (!_recording) return null;
    _recording = false;
    final path = await _recorder.stop();
    _recordingPath = null;
    return path == null ? null : File(path);
  }
  Future<void> cancelRecording() async {
    final file = await stopRecording();
    if (file != null && await file.exists()) await file.delete();
    final path = _recordingPath; _recordingPath = null;
    if (path != null && await File(path).exists()) await File(path).delete();
  }
  Future<File?> capturePhoto() async {
    final selected = await _picker.pickImage(source: ImageSource.camera, maxWidth: 1024, maxHeight: 1024, imageQuality: 75);
    if (selected == null) return null;
    final directory = await getTemporaryDirectory();
    final path = '${directory.path}/kidzen-photo-${DateTime.now().microsecondsSinceEpoch}.jpg';
    final compressed = await (() async {
      try {
        return await FlutterImageCompress.compressAndGetFile(selected.path, path,
          minWidth: 1024, minHeight: 1024, quality: 70, format: CompressFormat.jpeg, keepExif: false);
      } finally {
        // This source was created by the camera picker, not a gallery original.
        final source = File(selected.path);
        if (await source.exists()) await source.delete();
      }
    })();
    if (compressed == null) throw StateError('Please try another photo.');
    final file = File(compressed.path);
    if (await file.length() > 2 * 1024 * 1024) { await file.delete(); throw StateError('Photo is too large.'); }
    // Caller owns returned temporary file: delete after upload in a finally block.
    return file;
  }
  Future<void> dispose() async {
    _disposed = true;
    await cancelRecording();
    await _recorder.dispose();
  }
}
