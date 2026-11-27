<?php
declare(strict_types=1);

require_once __DIR__ . '/../includes/security.php';
require_once __DIR__ . '/../includes/sso.php';

send_security_headers(true);
start_secure_session();

$token = (string) ($_GET['token'] ?? '');
$next  = sanitize_next_target($_GET['next'] ?? null);

$verified = verify_signed_token($token, 'logout');
$sessUid  = (int) ($_SESSION['user_id'] ?? 0);

// Only destroy session if token signature is valid AND belongs to active session user
if ($verified !== null && $sessUid > 0 && (int) ($verified['sub'] ?? 0) === $sessUid) {
    destroy_session_data();
    start_secure_session();
    rotate_csrf_token();
    set_flash('success', 'You have been signed out from DocQ&A and Auth Portal.', 'login');
}

$suffix = $next === 'docqa' ? '?next=docqa' : '';
header('Location: ../index.php' . $suffix);
exit;
