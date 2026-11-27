<?php
declare(strict_types=1);

require_once __DIR__ . '/includes/security.php';
require_once __DIR__ . '/includes/sso.php';

send_security_headers(true);
start_secure_session();

$nextTarget = sanitize_next_target($_GET['next'] ?? null);

/* Redirect already-authenticated users to DocQ&A (when requested) or dashboard */
if (!empty($_SESSION['user_id']) && !empty($_SESSION['user_role'])) {
    if ($nextTarget === 'docqa') {
        $currentUser = [
            'id'    => (int) $_SESSION['user_id'],
            'name'  => (string) ($_SESSION['user_name'] ?? ''),
            'email' => (string) ($_SESSION['user_email'] ?? ''),
            'role'  => (string) $_SESSION['user_role'],
        ];
        header('Location: ' . build_docqa_sso_redirect_url($currentUser));
        exit;
    }
    header('Location: ' . dashboard_for_role((string) $_SESSION['user_role']));
    exit;
}

$flash      = consume_flash();
$queryTab   = strtolower(trim((string) ($_GET['tab'] ?? '')));
$defaultTab = $queryTab === 'register' ? 'register' : 'login';
$activeTab  = $flash['tab'] ?? $defaultTab;
$csrf       = csrf_token();
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Secure authentication portal">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="data:,">
  <title>Sign In — DocQ&amp;A</title>
  <link rel="stylesheet" href="assets/css/styles.css">
</head>
<body>

<main class="auth-shell" role="main">
  <section class="auth-card" aria-label="Authentication">

    <!-- Logo + Header -->
    <header class="auth-header">
      <div class="auth-logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <h1>DocQ&amp;A Access</h1>
      <p>Sign in or register to continue to DocQ&amp;A</p>
    </header>

    <!-- Segmented Toggle -->
    <div class="tab-switcher" id="tabSwitcher" role="tablist" aria-label="Authentication mode">
      <span class="tab-indicator" aria-hidden="true"></span>
      <button type="button" role="tab" id="loginTabBtn" data-target="login"
        class="tab-btn <?= $activeTab === 'login' ? 'is-active' : '' ?>"
        aria-selected="<?= $activeTab === 'login' ? 'true' : 'false' ?>"
        aria-controls="loginForm">Login</button>
      <button type="button" role="tab" id="registerTabBtn" data-target="register"
        class="tab-btn <?= $activeTab === 'register' ? 'is-active' : '' ?>"
        aria-selected="<?= $activeTab === 'register' ? 'true' : 'false' ?>"
        aria-controls="registerForm">Register</button>
    </div>

    <!-- Flash message -->
    <?php if ($flash): ?>
      <div class="alert alert-<?= e($flash['type']) ?>" role="alert" aria-live="assertive">
        <span class="alert-icon"><?= $flash['type'] === 'success' ? '✓' : '!' ?></span>
        <span><?= e($flash['message']) ?></span>
      </div>
    <?php endif; ?>

    <!-- Sliding Form Track -->
    <div class="forms-viewport" aria-live="polite">
      <div class="forms-track <?= $activeTab === 'register' ? 'show-register' : '' ?>" id="formsTrack">

        <!-- ── LOGIN FORM ─────────────────────────────────── -->
        <form id="loginForm" class="auth-form" role="tabpanel"
              action="actions/login.php" method="POST" novalidate
              autocomplete="on">
          <input type="hidden" name="csrf_token" value="<?= e($csrf) ?>">
          <input type="hidden" name="next" value="<?= e($nextTarget) ?>">

          <div class="field">
            <label for="loginEmail">Email address</label>
            <input type="email" id="loginEmail" name="email"
                   placeholder="you@example.com"
                   autocomplete="email" inputmode="email"
                   spellcheck="false" autocapitalize="off"
                   required maxlength="255">
            <small class="field-error" aria-live="polite"></small>
          </div>

          <div class="field">
            <label for="loginPassword">Password</label>
            <div class="password-wrap">
              <input type="password" id="loginPassword" name="password"
                     placeholder="Enter your password"
                     autocomplete="current-password"
                     required maxlength="72">
              <button type="button" class="toggle-pw"
                      data-toggle="loginPassword" aria-label="Show password">Show</button>
            </div>
            <small class="field-error" aria-live="polite"></small>
          </div>

          <button type="submit" class="btn-primary">
            <span class="spinner" aria-hidden="true"></span>
            <span class="btn-label">Sign In</span>
          </button>

          <p class="switch-hint">
            Don't have an account?
            <button type="button" class="link-btn" data-target="register">Create one</button>
          </p>
        </form>

        <!-- ── REGISTER FORM ──────────────────────────────── -->
        <form id="registerForm" class="auth-form" role="tabpanel"
              action="actions/register.php" method="POST" novalidate
              autocomplete="on">
          <input type="hidden" name="csrf_token" value="<?= e($csrf) ?>">
          <input type="hidden" name="next" value="<?= e($nextTarget) ?>">

          <div class="field">
            <label for="regName">Full name</label>
            <input type="text" id="regName" name="name"
                   placeholder="Jane Doe"
                   autocomplete="name"
                   minlength="2" maxlength="100" required>
            <small class="field-error" aria-live="polite"></small>
          </div>

          <div class="field">
            <label for="regEmail">Email address</label>
            <input type="email" id="regEmail" name="email"
                   placeholder="you@example.com"
                   autocomplete="email" inputmode="email"
                   spellcheck="false" autocapitalize="off"
                   required maxlength="255">
            <small class="field-error" aria-live="polite"></small>
          </div>

          <div class="field">
            <label for="regPassword">Password</label>
            <div class="password-wrap">
              <input type="password" id="regPassword" name="password"
                     placeholder="8+ chars, A-Z, a-z, 0-9, symbol"
                     autocomplete="new-password"
                     minlength="8" maxlength="72" required>
              <button type="button" class="toggle-pw"
                      data-toggle="regPassword" aria-label="Show password">Show</button>
            </div>
            <div class="pw-strength-bar" aria-hidden="true">
              <div class="pw-strength-fill" id="pwStrengthFill"></div>
            </div>
            <span class="pw-strength-label" id="pwStrengthLabel" aria-live="polite">
              Requires 8+ chars with uppercase, lowercase, number, and symbol
            </span>
            <small class="field-error" aria-live="polite"></small>
          </div>

          <div class="field">
            <label for="regRole">Account role</label>
            <div class="select-wrap">
              <select id="regRole" name="role" required autocomplete="off">
                <option value="user" selected>User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <small class="field-error" aria-live="polite"></small>
          </div>

          <button type="submit" class="btn-primary">
            <span class="spinner" aria-hidden="true"></span>
            <span class="btn-label">Create Account</span>
          </button>

          <p class="switch-hint">
            Already have an account?
            <button type="button" class="link-btn" data-target="login">Sign in</button>
          </p>
        </form>

      </div>
    </div>

  </section>
</main>

<script src="assets/js/auth.js" defer></script>
</body>
</html>
