<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/env.php';

/**
 * Resolves the client IP safely.
 * Note: Only trust X-Forwarded-For when running behind a known trusted reverse proxy.
 */
function get_client_ip(): string
{
    $remote = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    return filter_var($remote, FILTER_VALIDATE_IP) ? $remote : '0.0.0.0';
}

/**
 * Hashes a rate-limit subject (e.g. IP or IP|email) so raw IPs/emails are never stored.
 */
function rate_limit_key(string $subject): string
{
    $pepper = env('RATE_LIMIT_PEPPER', 'fallback-dev-pepper');
    return hash_hmac('sha256', $subject, $pepper);
}

/**
 * Checks whether the given action + subject is currently rate-limited / locked out.
 *
 * @return array{allowed:bool, retry_after:int}
 */
function check_rate_limit(PDO $pdo, string $action, string $subject): array
{
    $key = rate_limit_key($subject);
    $now = time();

    $stmt = $pdo->prepare(
        'SELECT attempts, window_start, locked_until
         FROM rate_limits
         WHERE action = :action AND identifier = :identifier
         LIMIT 1'
    );
    $stmt->execute([':action' => $action, ':identifier' => $key]);
    $row = $stmt->fetch();

    if (!$row) {
        return ['allowed' => true, 'retry_after' => 0];
    }

    if (!empty($row['locked_until'])) {
        $lockedTs = strtotime((string) $row['locked_until']);
        if ($lockedTs !== false && $lockedTs > $now) {
            return ['allowed' => false, 'retry_after' => $lockedTs - $now];
        }
    }

    return ['allowed' => true, 'retry_after' => 0];
}

/**
 * Records a failed or throttled attempt inside a MySQL sliding window.
 * Triggers a lockout when attempts >= $maxAttempts within $windowSec.
 *
 * @return array{locked:bool, retry_after:int, remaining:int}
 */
function record_rate_limit_attempt(
    PDO $pdo,
    string $action,
    string $subject,
    int $maxAttempts,
    int $windowSec,
    int $lockoutSec
): array {
    $key = rate_limit_key($subject);
    $now = time();

    $stmt = $pdo->prepare(
        'SELECT id, attempts, window_start, locked_until
         FROM rate_limits
         WHERE action = :action AND identifier = :identifier
         LIMIT 1'
    );
    $stmt->execute([':action' => $action, ':identifier' => $key]);
    $row = $stmt->fetch();

    if (!$row) {
        $lockedUntil = $maxAttempts <= 1 ? gmdate('Y-m-d H:i:s', $now + $lockoutSec) : null;
        $ins = $pdo->prepare(
            'INSERT INTO rate_limits (action, identifier, attempts, window_start, locked_until)
             VALUES (:action, :identifier, 1, :window_start, :locked_until)'
        );
        $ins->execute([
            ':action'       => $action,
            ':identifier'   => $key,
            ':window_start' => gmdate('Y-m-d H:i:s', $now),
            ':locked_until' => $lockedUntil,
        ]);

        return [
            'locked'      => $lockedUntil !== null,
            'retry_after' => $lockedUntil !== null ? $lockoutSec : 0,
            'remaining'   => max(0, $maxAttempts - 1),
        ];
    }

    $windowStartTs = strtotime((string) $row['window_start']) ?: 0;
    $lockedTs      = !empty($row['locked_until']) ? (strtotime((string) $row['locked_until']) ?: 0) : 0;

    // Reset counter if the previous window or lockout has expired
    $expiredWindow  = ($now - $windowStartTs) >= $windowSec;
    $expiredLockout = $lockedTs > 0 && $lockedTs <= $now;

    if ($expiredWindow || $expiredLockout) {
        $attempts    = 1;
        $windowStart = gmdate('Y-m-d H:i:s', $now);
        $lockedUntil = $maxAttempts <= 1 ? gmdate('Y-m-d H:i:s', $now + $lockoutSec) : null;
    } else {
        $attempts    = (int) $row['attempts'] + 1;
        $windowStart = (string) $row['window_start'];
        $lockedUntil = $attempts >= $maxAttempts
            ? gmdate('Y-m-d H:i:s', $now + $lockoutSec)
            : null;
    }

    $upd = $pdo->prepare(
        'UPDATE rate_limits
         SET attempts = :attempts, window_start = :window_start, locked_until = :locked_until
         WHERE id = :id'
    );
    $upd->execute([
        ':attempts'     => $attempts,
        ':window_start' => $windowStart,
        ':locked_until' => $lockedUntil,
        ':id'           => $row['id'],
    ]);

    return [
        'locked'      => $lockedUntil !== null,
        'retry_after' => $lockedUntil !== null ? $lockoutSec : 0,
        'remaining'   => max(0, $maxAttempts - $attempts),
    ];
}

/**
 * Clears rate-limit state upon successful authentication.
 */
function clear_rate_limit(PDO $pdo, string $action, string $subject): void
{
    $key  = rate_limit_key($subject);
    $stmt = $pdo->prepare(
        'DELETE FROM rate_limits WHERE action = :action AND identifier = :identifier'
    );
    $stmt->execute([':action' => $action, ':identifier' => $key]);
}
