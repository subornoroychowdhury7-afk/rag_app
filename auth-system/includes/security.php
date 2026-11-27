<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/env.php';

/**
 * Detects whether the current request arrived over TLS/HTTPS
 * (including behind a reverse proxy forwarding X-Forwarded-Proto).
 */
function is_https_request(): bool
{
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }
    if ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443') {
        return true;
    }
    if (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') {
        return true;
    }
    return false;
}

/**
 * Emits defense-in-depth HTTP security headers (CSP, nosniff, clickjacking, HSTS).
 * Safe to call once before any response body is emitted.
 */
function send_security_headers(bool $noStore = false): void
{
    if (headers_sent()) {
        return;
    }

    // Strict Content Security Policy — blocks inline scripts and untrusted origins
    $csp = implode('; ', [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "form-action 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
    ]);

    header('Content-Security-Policy: ' . $csp);
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');

    // RFC 6797: Send HSTS only over HTTPS connections
    if (is_https_request()) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains; preload');
    }

    if ($noStore) {
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');
    }
}

/**
 * Starts a hardened PHP session using HttpOnly, SameSite=Strict, and Secure flags.
 */
function start_secure_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $idleTimeout = env_int('SESSION_IDLE_TIMEOUT', 1800);
    $cookieSecure = is_https_request() || env_bool('COOKIE_SECURE', false);

    ini_set('session.use_strict_mode',  '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime',   (string) max(300, $idleTimeout));

    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'domain'   => '',
        'secure'   => $cookieSecure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);

    session_start();

    // Enforce rolling inactivity timeout for authenticated sessions
    if (!empty($_SESSION['user_id'])) {
        $lastActivity = (int) ($_SESSION['last_activity'] ?? time());
        if ((time() - $lastActivity) > $idleTimeout) {
            destroy_session_data();
            session_start();
            set_flash('error', 'Your session expired due to inactivity. Please sign in again.', 'login');
            return;
        }
        $_SESSION['last_activity'] = time();
    }
}

/**
 * Clears session data, expires the browser cookie, and destroys server session state.
 */
function destroy_session_data(): void
{
    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            [
                'expires'  => time() - 42000,
                'path'     => $params['path'],
                'domain'   => $params['domain'],
                'secure'   => $params['secure'],
                'httponly' => $params['httponly'],
                'samesite' => $params['samesite'] ?? 'Strict',
            ]
        );
    }

    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
}

/** HTML-escape output — prevents Stored/Reflected XSS. */
function e(string $v): string
{
    return htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Lazy-create a 256-bit CSRF token bound to the current session. */
function csrf_token(): string
{
    start_secure_session();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['csrf_token'];
}

/** Rotate CSRF token (call after login / privilege change). */
function rotate_csrf_token(): string
{
    start_secure_session();
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    return (string) $_SESSION['csrf_token'];
}

/** Constant-time CSRF verification + same-origin check when Origin header is present. */
function verify_csrf_token(?string $token): bool
{
    start_secure_session();

    // Defense-in-depth: validate Origin header if supplied by browser
    if (!empty($_SERVER['HTTP_ORIGIN']) && !empty($_SERVER['HTTP_HOST'])) {
        $originHost = parse_url((string) $_SERVER['HTTP_ORIGIN'], PHP_URL_HOST);
        $serverHost = explode(':', (string) $_SERVER['HTTP_HOST'])[0];
        if (!is_string($originHost) || strcasecmp($originHost, $serverHost) !== 0) {
            return false;
        }
    }

    if (!is_string($token) || empty($_SESSION['csrf_token'])) {
        return false;
    }
    return hash_equals((string) $_SESSION['csrf_token'], $token);
}

/**
 * Validates password complexity policy:
 *  - 8 to 72 bytes (bcrypt safe limit)
 *  - Uppercase, lowercase, digit, and symbol required
 *  - Rejects common passwords and email local-part reuse
 *
 * @return string[] List of policy failure messages (empty = valid)
 */
function validate_password_strength(string $password, string $email = ''): array
{
    $errors = [];
    $len    = strlen($password);

    if ($len < 8 || $len > 72) {
        $errors[] = 'Password must be 8–72 characters.';
    }
    if (!preg_match('/[A-Z]/', $password)) {
        $errors[] = 'Password must contain at least one uppercase letter.';
    }
    if (!preg_match('/[a-z]/', $password)) {
        $errors[] = 'Password must contain at least one lowercase letter.';
    }
    if (!preg_match('/[0-9]/', $password)) {
        $errors[] = 'Password must contain at least one number.';
    }
    if (!preg_match('/[^A-Za-z0-9]/', $password)) {
        $errors[] = 'Password must contain at least one special character.';
    }

    $lowerPw = strtolower($password);
    $weakList = ['password123!', 'admin@123', 'qwerty123!', 'welcome123!', 'letmein123!'];
    if (in_array($lowerPw, $weakList, true)) {
        $errors[] = 'Password is too common. Choose a more unique password.';
    }

    if ($email !== '' && str_contains($email, '@')) {
        $localPart = strtolower(explode('@', $email, 2)[0]);
        if (strlen($localPart) >= 3 && str_contains($lowerPw, $localPart)) {
            $errors[] = 'Password must not contain your email username.';
        }
    }

    return $errors;
}

/** Store a one-time flash message. */
function set_flash(string $type, string $message, string $tab = 'login'): void
{
    start_secure_session();
    $_SESSION['flash'] = compact('type', 'message', 'tab');
}

/** Retrieve and immediately clear the pending flash. */
function consume_flash(): ?array
{
    start_secure_session();
    $flash = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return is_array($flash) ? $flash : null;
}

/** Map a validated role to its dashboard file. */
function dashboard_for_role(string $role): string
{
    return $role === 'admin' ? 'admin_page.php' : 'user_page.php';
}

/**
 * Enforce authentication + optional role check + security headers.
 *
 * @return array{id:int, name:string, email:string, role:string}
 */
function require_auth(?string $requiredRole = null): array
{
    send_security_headers(true);
    start_secure_session();

    if (empty($_SESSION['user_id']) || empty($_SESSION['user_role'])) {
        set_flash('error', 'Please sign in to access that page.', 'login');
        header('Location: index.php');
        exit;
    }

    $currentRole = (string) $_SESSION['user_role'];

    if ($requiredRole !== null && $currentRole !== $requiredRole) {
        header('Location: ' . dashboard_for_role($currentRole));
        exit;
    }

    return [
        'id'    => (int) $_SESSION['user_id'],
        'name'  => (string) ($_SESSION['user_name'] ?? ''),
        'email' => (string) ($_SESSION['user_email'] ?? ''),
        'role'  => $currentRole,
    ];
}
