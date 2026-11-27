<?php
declare(strict_types=1);

require_once __DIR__ . '/../includes/security.php';

send_security_headers(true);
start_secure_session();

// Only accept POST + valid CSRF token so third-party <img> tags cannot force logout
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !verify_csrf_token($_POST['csrf_token'] ?? null)) {
    header('Location: ../index.php');
    exit;
}

destroy_session_data();

// Fresh clean session solely for the sign-out flash message
start_secure_session();
rotate_csrf_token();
set_flash('success', 'You have been signed out safely.', 'login');

header('Location: ../index.php');
exit;
