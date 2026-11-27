<?php
declare(strict_types=1);

require_once __DIR__ . '/env.php';

/**
 * Returns a shared PDO database connection (singleton per request).
 * Credentials come exclusively from .env / OS environment variables.
 */
function get_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $host    = env('DB_HOST', '127.0.0.1');
    $port    = env('DB_PORT', '3306');
    $dbName  = env('DB_NAME', 'auth_system');
    $user    = env('DB_USER', 'root');
    $pass    = env('DB_PASS', '');
    $charset = 'utf8mb4';

    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=%s',
        $host,
        $port,
        $dbName,
        $charset
    );

    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false, // Force native MySQL prepared statements
    ];

    try {
        $pdo = new PDO($dsn, $user, $pass, $options);
        return $pdo;
    } catch (PDOException $e) {
        error_log('[auth-system] DB connection failed: ' . $e->getMessage());
        http_response_code(500);
        exit('Service temporarily unavailable.');
    }
}
