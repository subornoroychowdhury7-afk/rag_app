<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/security.php';
require_once __DIR__ . '/../includes/rate_limiter.php';
require_once __DIR__ . '/../includes/sso.php';

send_security_headers(true);
start_secure_session();

$nextTarget = sanitize_next_target($_POST['next'] ?? null);
$backUrl    = $nextTarget === 'docqa' ? '../index.php?next=docqa' : '../index.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: ' . $backUrl);
    exit;
}

if (!verify_csrf_token($_POST['csrf_token'] ?? null)) {
    set_flash('error', 'Security token expired — please try again.', 'register');
    header('Location: ' . $backUrl);
    exit;
}

try {
    $pdo       = get_db();
    $ip        = get_client_ip();
    $maxReg    = env_int('RATE_LIMIT_REGISTER_MAX', 5);
    $windowSec = env_int('RATE_LIMIT_WINDOW_SEC', 900);
    $lockSec   = env_int('RATE_LIMIT_LOCKOUT_SEC', 900);

    // Rate-limit automated registration spam per client IP
    $limitState = check_rate_limit($pdo, 'register', $ip);
    if (!$limitState['allowed']) {
        $mins = max(1, (int) ceil($limitState['retry_after'] / 60));
        set_flash('error', "Too many registration attempts. Try again in {$mins} minute(s).", 'register');
        header('Location: ' . $backUrl);
        exit;
    }

    // Collect & normalize input
    $name     = trim((string) ($_POST['name']     ?? ''));
    $email    = mb_strtolower(trim((string) ($_POST['email'] ?? '')), 'UTF-8');
    $password = (string) ($_POST['password'] ?? '');
    $role     = mb_strtolower(trim((string) ($_POST['role']  ?? 'user')), 'UTF-8');

    // Server-side validation
    $errors = [];

    $nameLen = mb_strlen($name, 'UTF-8');
    if ($nameLen < 2 || $nameLen > 100) {
        $errors[] = 'Full name must be 2–100 characters.';
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email, 'UTF-8') > 255) {
        $errors[] = 'Please enter a valid email address.';
    }

    // Enforce strong password complexity policy
    $errors = array_merge($errors, validate_password_strength($password, $email));

    if (!in_array($role, ['user', 'admin'], true)) {
        $errors[] = 'Invalid role selected.';
    }

    if (!empty($errors)) {
        record_rate_limit_attempt($pdo, 'register', $ip, $maxReg, $windowSec, $lockSec);
        set_flash('error', implode(' ', $errors), 'register');
        header('Location: ' . $backUrl);
        exit;
    }

    // Count valid registration attempts toward IP quota as well (prevents account enumeration/flood)
    record_rate_limit_attempt($pdo, 'register', $ip, $maxReg, $windowSec, $lockSec);

    // Pre-insert duplicate email check (prepared statement)
    $check = $pdo->prepare('SELECT id FROM users WHERE email = :e LIMIT 1');
    $check->execute([':e' => $email]);
    if ($check->fetch()) {
        set_flash('error', 'An account with that email already exists.', 'register');
        header('Location: ' . $backUrl);
        exit;
    }

    // bcrypt hash with cost 12
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
    if ($hash === false) {
        throw new RuntimeException('password_hash() failed unexpectedly.');
    }

    $ins = $pdo->prepare(
        'INSERT INTO users (name, email, password, role) VALUES (:n, :e, :p, :r)'
    );
    $ins->execute([
        ':n' => $name,
        ':e' => $email,
        ':p' => $hash,
        ':r' => $role,
    ]);

    set_flash('success', 'Account created! You can now sign in.', 'login');
    header('Location: ' . $backUrl);
    exit;

} catch (PDOException $ex) {
    if ($ex->getCode() === '23000') {
        set_flash('error', 'An account with that email already exists.', 'register');
    } else {
        error_log('[auth-system] register PDO error: ' . $ex->getMessage());
        set_flash('error', 'Registration failed — please try again later.', 'register');
    }
    header('Location: ' . $backUrl);
    exit;
} catch (RuntimeException $ex) {
    error_log('[auth-system] register runtime error: ' . $ex->getMessage());
    set_flash('error', 'An internal error occurred — please try again.', 'register');
    header('Location: ' . $backUrl);
    exit;
}
