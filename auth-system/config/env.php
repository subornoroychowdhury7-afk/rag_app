<?php
declare(strict_types=1);

/**
 * Zero-dependency .env file parser.
 * Loads environment variables once per request into $_ENV and $_SERVER
 * without mutating process-global getenv() state unnecessarily.
 */
function load_env(?string $path = null): void
{
    static $loaded = false;
    if ($loaded) {
        return;
    }
    $loaded = true;

    $envFile = $path ?? dirname(__DIR__) . '/.env';
    if (!is_file($envFile) || !is_readable($envFile)) {
        return;
    }

    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return;
    }

    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '#')) {
            continue;
        }

        $eqPos = strpos($trimmed, '=');
        if ($eqPos === false) {
            continue;
        }

        $key = trim(substr($trimmed, 0, $eqPos));
        $val = trim(substr($trimmed, $eqPos + 1));

        // Strip matching surrounding quotes ('...' or "...")
        if (strlen($val) >= 2) {
            $first = $val[0];
            $last  = $val[strlen($val) - 1];
            if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                $val = substr($val, 1, -1);
            }
        }

        // Do not overwrite real OS-level environment variables injected by container/systemd
        if (!array_key_exists($key, $_ENV) && getenv($key) === false) {
            $_ENV[$key]    = $val;
            $_SERVER[$key] = $val;
        }
    }
}

/**
 * Retrieve an environment variable safely with an optional default.
 */
function env(string $key, string $default = ''): string
{
    load_env();
    if (isset($_ENV[$key])) {
        return (string) $_ENV[$key];
    }
    if (isset($_SERVER[$key])) {
        return (string) $_SERVER[$key];
    }
    $sys = getenv($key);
    return $sys !== false ? (string) $sys : $default;
}

/**
 * Retrieve a boolean environment flag.
 */
function env_bool(string $key, bool $default = false): bool
{
    $raw = strtolower(trim(env($key, '')));
    if ($raw === '') {
        return $default;
    }
    return in_array($raw, ['1', 'true', 'yes', 'on'], true);
}

/**
 * Retrieve an integer environment flag.
 */
function env_int(string $key, int $default): int
{
    $raw = trim(env($key, ''));
    return is_numeric($raw) ? (int) $raw : $default;
}
