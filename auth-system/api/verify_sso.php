<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/security.php';
require_once __DIR__ . '/../includes/sso.php';

$allowedOrigin = rtrim(env('DOCQA_URL', 'http://localhost:3000'), '/');

header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

// Strict single-origin CORS allowlist (never wildcard '*')
$reqOrigin = rtrim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), '/');
if ($reqOrigin !== '' && strcasecmp($reqOrigin, $allowedOrigin) === 0) {
    header('Access-Control-Allow-Origin: ' . $allowedOrigin);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Vary: Origin');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['valid' => false, 'error' => 'Method not allowed']);
    exit;
}

$rawBody = file_get_contents('php://input');
$body    = is_string($rawBody) ? json_decode($rawBody, true) : null;
$token   = is_array($body) ? (string) ($body['token'] ?? '') : '';

$claims = verify_signed_token($token, 'sso');
if ($claims === null) {
    http_response_code(401);
    echo json_encode(['valid' => false, 'error' => 'Invalid or expired SSO token']);
    exit;
}

try {
    // Re-verify user still exists and fetch authoritative name/role from MariaDB
    $pdo  = get_db();
    $stmt = $pdo->prepare('SELECT id, name, email, role FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => (int) ($claims['sub'] ?? 0)]);
    $user = $stmt->fetch();

    if (!$user) {
        http_response_code(401);
        echo json_encode(['valid' => false, 'error' => 'Account not found']);
        exit;
    }

    echo json_encode([
        'valid' => true,
        'user'  => [
            'id'    => (int) $user['id'],
            'name'  => (string) $user['name'],
            'email' => (string) $user['email'],
            'role'  => (string) $user['role'],
        ],
        'logout_token' => create_logout_token((int) $user['id']),
    ], JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    error_log('[auth-system] verify_sso error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['valid' => false, 'error' => 'Verification service error']);
}
