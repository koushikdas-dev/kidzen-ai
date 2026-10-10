import 'tutor_api.dart';

// Adapt these callbacks to your existing Google login, store purchase state and
// Firebase XP wallet. This is client-side gating, NOT server purchase verification.
class TutorAccessController {
  final bool Function() isLoggedIn;
  final Future<bool> Function() hasPremium;
  // Must atomically reserve/debit XP in your existing wallet. Return a unique
  // reservation ID, or null for insufficient XP. Never just read then subtract.
  final Future<String?> Function(int amount) reserveXp;
  // Use idempotent callbacks so a duplicate callback cannot double-charge/refund.
  final Future<void> Function(String reservationId) commitXp;
  final Future<void> Function(String reservationId) refundXp;
  final int xpPerQuestion;
  bool _busy = false;
  TutorAccessController({required this.isLoggedIn, required this.hasPremium,
    required this.reserveXp, required this.commitXp, required this.refundXp,
    this.xpPerQuestion = 1}) { if (xpPerQuestion <= 0) throw ArgumentError('XP cost must be positive.'); }

  Future<TutorReply> ask(Future<TutorReply> Function() sendQuestion) async {
    if (_busy) throw const TutorApiException('question_in_progress', 409);
    if (!isLoggedIn()) throw const TutorApiException('login_required', 401);
    _busy = true;
    String? reservation;
    TutorReply? reply;
    try {
      if (!await hasPremium()) {
        reservation = await reserveXp(xpPerQuestion);
        if (reservation == null) throw const TutorApiException('premium_or_xp_required', 402);
      }
      try { reply = await sendQuestion(); }
      catch (_) {
        if (reservation != null) {
          final id = reservation; reservation = null; await refundXp(id);
        }
        rethrow;
      }
      if (reservation != null) {
        final id = reservation; reservation = null;
        // No XP charge for outages, privacy/safety alternatives or adult-help.
        // Reserve before the request; the app settles only answered replies.
        if (reply.status == 'answered') { await commitXp(id); }
        else { await refundXp(id); }
      }
      return reply;
    } finally { _busy = false; }
  }
}
