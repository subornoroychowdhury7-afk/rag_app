<?php
declare(strict_types=1);

/**
 * Front-controller router for PHP's built-in development server (`php -S`).
 * Blocks direct HTTP access to .env, internal PHP modules, SQL files, dotfiles,
 * and path traversal attempts.
 */
$uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$decoded = rawurldecode($uriPath);

$blockedPatterns = [
    '#^/\.#',
    '#^/(config|includes|sql)/#i',
    '#\.(env|sql|ps1|log|md|ini)$#i',
    '#^/router\.php$#i',
];

foreach ($blockedPatterns as $pattern) {
    if (preg_match($pattern, $decoded)) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=UTF-8');
        exit('403 Forbidden');
    }
}

$rootReal = realpath(__DIR__);
$target   = realpath(__DIR__ . $decoded);

if ($decoded === '/' || $decoded === '') {
    require __DIR__ . '/index.php';
    return true;
}

// Enforce strict webroot containment (prevents ../ path traversal)
if ($target === false || $rootReal === false || !str_starts_with($target, $rootReal . DIRECTORY_SEPARATOR)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('404 Not Found');
}

if (is_file($target) && pathinfo($target, PATHINFO_EXTENSION) !== 'php') {
    return false; // Let built-in server serve CSS/JS/static assets
}

if (is_file($target) && pathinfo($target, PATHINFO_EXTENSION) === 'php') {
    require $target;
    return true;
}

http_response_code(404);
header('Content-Type: text/plain; charset=UTF-8');
exit('404 Not Found');
