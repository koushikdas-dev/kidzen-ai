import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';
import 'tutor_api.dart';

class TutorReplyCard extends StatefulWidget {
  final TutorApi api;
  final TutorReply reply;
  final VoidCallback onAdultHelp;
  // Pass already localized labels from your app's localization system.
  final String listenLabel, helpLabel, audioUnavailableLabel, aiVoiceLabel;
  const TutorReplyCard({super.key, required this.api, required this.reply,
    required this.onAdultHelp, required this.listenLabel, required this.helpLabel,
    required this.audioUnavailableLabel, required this.aiVoiceLabel});
  @override State<TutorReplyCard> createState() => _TutorReplyCardState();
}
class _TutorReplyCardState extends State<TutorReplyCard> with WidgetsBindingObserver {
  final _player = AudioPlayer();
  File? _audio;
  Directory? _sessionDirectory;
  bool _loading = false;
  bool _disposed = false;
  String? _audioError;
  @override void initState() { super.initState(); WidgetsBinding.instance.addObserver(this); }
  @override void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) _player.pause();
  }
  Future<void> _listen() async {
    if (_loading || _disposed) return;
    setState(() { _loading = true; _audioError = null; });
    try {
      if (_audio == null) {
        final bytes = await widget.api.fetchSpeech(widget.reply);
        if (_disposed) return;
        final root = await getTemporaryDirectory();
        if (_disposed) return;
        final directory = await root.createTemp('kidzen-tutor-');
        if (_disposed) { await directory.delete(recursive: true); return; }
        _sessionDirectory = directory;
        final file = File('${directory.path}/reply.mp3');
        await file.writeAsBytes(bytes, flush: true);
        if (_disposed) { if (await directory.exists()) await directory.delete(recursive: true); return; }
        _audio = file;
      }
      await _player.setFilePath(_audio!.path);
      if (_disposed) return;
      // Replays use the same local file, so no extra TTS call or speech quota.
      await _player.seek(Duration.zero);
      if (_disposed) return;
      _player.play();
    } catch (_) {
      if (mounted) setState(() => _audioError = widget.audioUnavailableLabel);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }
  Future<void> _cleanup() async {
    await _player.dispose();
    final directory = _sessionDirectory;
    if (directory != null && await directory.exists()) await directory.delete(recursive: true);
  }
  @override void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _cleanup();
    super.dispose();
  }
  @override Widget build(BuildContext context) {
    final reply = widget.reply;
    return Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(
      crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(reply.answer, style: const TextStyle(fontSize: 22, height: 1.5)),
        if (reply.visualPath != null && !reply.needsAdultHelp) Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Semantics(label: reply.visualAlt, image: true,
            child: SvgPicture.network(widget.api.endpoint(reply.visualPath!).toString(), height: 220,
              placeholderBuilder: (_) => const SizedBox(height: 220)))),
        if (reply.followUp.isNotEmpty && !reply.needsAdultHelp)
          Text(reply.followUp, style: const TextStyle(fontSize: 20, height: 1.5)),
        if (reply.speechToken != null) FilledButton.icon(
          onPressed: _loading ? null : _listen,
          icon: Icon(_loading ? Icons.hourglass_top : Icons.volume_up),
          label: Text(widget.listenLabel)),
        Text(widget.aiVoiceLabel, style: Theme.of(context).textTheme.bodySmall),
        if (_audioError != null) Text(_audioError!),
        if (reply.needsAdultHelp) FilledButton.icon(onPressed: widget.onAdultHelp,
          icon: const Icon(Icons.support_agent), label: Text(widget.helpLabel)),
      ])));
  }
}
