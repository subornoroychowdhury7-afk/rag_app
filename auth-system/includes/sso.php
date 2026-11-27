<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/env.php';

/** URL-safe base64 encoding without padding. */
function b64url_encode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/** URL-safe base64 decoding. */
function b64url_decode(string $data): string|false
{
    $pad = strlen($data) % 4;
    if ($pad > 0) {
        $data .= str_repeat('=', 4 - $pad);
    }
    return base64_decode(strtr($data, '-_', '+/'), true);
}

/**
 * Returns the HMAC secret used to sign DocQ&A SSO and logout tokens.
 */
function sso_secret(): string
{
    return env('DOCQA_SSO_SECRET', 'dev-fallback-change-in-prod-9c4e7b2a1f8d');
}

/**
 * Strict allowlist for post-login `next` redirect targets (prevents open redirects).
 */
function sanitize_next_target(?string $raw): string
{
    return 'docqa';
}

/**
 * Creates a short-lived (120 s), HMAC-SHA256 signed SSO token for DocQ&A handoff.
 *
 * @param array{id:int, name:string, email:string, role:string} $user
 */
function create_sso_token(array $user, int $ttlSeconds = 120): string
{
    $now = time();
    $payload = [
        'typ'   => 'sso',
        'sub'   => (int) $user['id'],
        'name'  => (string) $user['name'],
        'email' => (string) $user['email'],
        'role'  => (string) $user['role'],
        'iat'   => $now,
        'exp'   => $now + $ttlSeconds,
        'nonce' => bin2hex(random_bytes(8)),
    ];

    $encoded = b64url_encode((string) json_encode($payload, JSON_THROW_ON_ERROR));
    $sig     = b64url_encode(hash_hmac('sha256', $encoded, sso_secret(), true));
    return $encoded . '.' . $sig;
}

/**
 * Creates an HMAC-SHA256 signed logout token bound to the user's ID (12h TTL).
 */
function create_logout_token(int $userId, int $ttlSeconds = 43200): string
{
    $now = time();
    $payload = [
        'typ' => 'logout',
        'sub' => $userId,
        'iat' => $now,
        'exp' => $now + $ttlSeconds,
    ];

    $encoded = b64url_encode((string) json_encode($payload, JSON_THROW_ON_ERROR));
    $sig     = b64url_encode(hash_hmac('sha256', $encoded, sso_secret(), true));
    return $encoded . '.' . $sig;
}

/**
 * Verifies an HMAC-SHA256 signed token of the expected type ('sso' or 'logout').
 *
 * @return array<string, mixed>|null
 */
function verify_signed_token(string $token, string $expectedType): ?array
{
    $parts = explode('.', trim($token));
    if (count($parts) !== 2) {
        return null;
    }

    [$encoded, $providedSig] = $parts;
    $expectedSig = b64url_encode(hash_hmac('sha256', $encoded, sso_secret(), true));

    if (!hash_equals($expectedSig, $providedSig)) {
        return null;
    }

    $json = b64url_decode($encoded);
    if ($json === false) {
        return null;
    }

    $data = json_decode($json, true);
    if (!is_array($data)) {
        return null;
    }

    if (($data['typ'] ?? '') !== $expectedType) {
        return null;
    }

    $exp = (int) ($data['exp'] ?? 0);
    if ($exp <= time()) {
        return null;
    }

    return $data;
}

/**
 * Builds the DocQ&A launch URL with a freshly minted signed SSO token.
 *
 * @param array{id:int, name:string, email:string, role:string} $user
 */
function build_docqa_sso_redirect_url(array $user): string
{
    $baseUrl = rtrim(env('DOCQA_URL', 'http://localhost:3000'), '/');
    $token   = create_sso_token($user);
    return $baseUrl . '/?sso=' . rawurlencode($token);
}
