<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/security.php';
require_once __DIR__ . '/../includes/rate_limiter.php';
require_once __DIR__ . '/../includes/sso.php';

send_security_headers(true);
start_secure_session();

$nextTarget = sanitize_next_target($_POST['next'] ?? null);
$loginBack  = $nextTarget === 'docqa' ? '../index.php?next=docqa' : '../index.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: ' . $loginBack);
    exit;
}

if (!verify_csrf_token($_POST['csrf_token'] ?? null)) {
    set_flash('error', 'Security token expired — please try again.', 'login');
    header('Location: ' . $loginBack);
    exit;
}

$email    = mb_strtolower(trim((string) ($_POST['email'] ?? '')), 'UTF-8');
$password = (string) ($_POST['password'] ?? '');

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $password === '') {
    set_flash('error', 'Please enter a valid email and password.', 'login');
    header('Location: ' . $loginBack);
    exit;
}

try {
    $pdo       = get_db();
    $ip        = get_client_ip();
    $maxLogin  = env_int('RATE_LIMIT_LOGIN_MAX', 5);
    $windowSec = env_int('RATE_LIMIT_WINDOW_SEC', 900);
    $lockSec   = env_int('RATE_LIMIT_LOCKOUT_SEC', 900);

    // Track both IP-wide credential stuffing AND targeted IP+email brute force
    $ipSubject   = 'ip:' . $ip;
    $acctSubject = 'acct:' . $ip . '|' . $email;

    $ipLimit   = check_rate_limit($pdo, 'login_ip', $ipSubject);
    $acctLimit = check_rate_limit($pdo, 'login_acct', $acctSubject);

    if (!$ipLimit['allowed'] || !$acctLimit['allowed']) {
        $retrySec = max($ipLimit['retry_after'], $acctLimit['retry_after']);
        $mins     = max(1, (int) ceil($retrySec / 60));
        set_flash('error', "Too many failed login attempts. Try again in {$mins} minute(s).", 'login');
        header('Location: ' . $loginBack);
        exit;
    }

    $stmt = $pdo->prepare(
        'SELECT id, name, email, password, role FROM users WHERE email = :e LIMIT 1'
    );
    $stmt->execute([':e' => $email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, (string) $user['password'])) {
        record_rate_limit_attempt($pdo, 'login_ip',   $ipSubject,   $maxLogin * 2, $windowSec, $lockSec);
        $acctRes = record_rate_limit_attempt($pdo, 'login_acct', $acctSubject, $maxLogin,     $windowSec, $lockSec);

        if ($acctRes['locked']) {
            $mins = max(1, (int) ceil($acctRes['retry_after'] / 60));
            set_flash('error', "Account login temporarily locked after repeated failures. Try again in {$mins} minute(s).", 'login');
        } else {
            // Generic message prevents username/email enumeration
            set_flash('error', "Invalid email or password. ({$acctRes['remaining']} attempt(s) remaining)", 'login');
        }

        header('Location: ' . $loginBack);
        exit;
    }

    // Clear rate-limit counters on valid login
    clear_rate_limit($pdo, 'login_ip',   $ipSubject);
    clear_rate_limit($pdo, 'login_acct', $acctSubject);

    // Transparently rehash if cost rises in future
    if (password_needs_rehash($user['password'], PASSWORD_BCRYPT, ['cost' => 12])) {
        $newHash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        $pdo->prepare('UPDATE users SET password = :p WHERE id = :id')
            ->execute([':p' => $newHash, ':id' => $user['id']]);
    }

    // Mitigate session fixation + rotate CSRF token upon authentication
    session_regenerate_id(true);
    rotate_csrf_token();

    $_SESSION['user_id']       = (int) $user['id'];
    $_SESSION['user_name']     = (string) $user['name'];
    $_SESSION['user_email']    = (string) $user['email'];
    $_SESSION['user_role']     = (string) $user['role'];
    $_SESSION['last_activity'] = time();

    if ($nextTarget === 'docqa') {
        $ssoUser = [
            'id'    => (int) $user['id'],
            'name'  => (string) $user['name'],
            'email' => (string) $user['email'],
            'role'  => (string) $user['role'],
        ];
        header('Location: ' . build_docqa_sso_redirect_url($ssoUser));
        exit;
    }

    header('Location: ../' . dashboard_for_role($user['role']));
    exit;

} catch (PDOException $ex) {
    error_log('[auth-system] login PDO error: ' . $ex->getMessage());
    set_flash('error', 'Unable to sign in right now — please try again.', 'login');
    header('Location: ../index.php');
    exit;
}
