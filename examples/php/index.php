<?php

declare(strict_types=1);

/*
 * Plain PHP form protected by OpenWAF Verify.
 *
 *   composer install            (at the repository root)
 *   OPENWAF_VERIFY_SECRET=ows_test_pass php -S 127.0.0.1:8080 examples/php/index.php
 *
 * The widget script is served first-party by the OpenWAF edge at
 * /__waf/challenge/v1/widget.js on your own host, so the page has to be
 * reached through the edge to render the widget. Without the edge you can
 * still exercise the server side:
 *
 *   curl -d owaf-verify-response=v1.TEST.TOKEN -d email=a@example.com http://127.0.0.1:8080/
 */

require __DIR__ . '/../../vendor/autoload.php';

use OpenWAF\Verify\Siteverify\Client;
use OpenWAF\Verify\Siteverify\SiteverifyException;
use OpenWAF\Verify\TestKeys;

$sitekey = getenv('OPENWAF_VERIFY_SITEKEY') ?: TestKeys::SITEKEY_PASS;
$secret = getenv('OPENWAF_VERIFY_SECRET') ?: TestKeys::SECRET_PASS;

$message = null;
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $token = is_string($_POST['owaf-verify-response'] ?? null) ? $_POST['owaf-verify-response'] : '';
    $client = new Client($secret);
    try {
        $result = $client->verify(
            $token,
            remoteIp: $_SERVER['REMOTE_ADDR'] ?? null,
            idempotencyKey: Client::idempotencyKey(),
            // Test secrets answer without an action, so only enforce it with a real secret.
            expectedAction: str_starts_with($secret, 'ows_test_') ? null : 'signup',
        );
        if ($result->success) {
            $message = 'Thanks, you are signed up.';
        } else {
            http_response_code(400);
            $message = 'Verification failed: ' . implode(', ', $result->errorCodes);
        }
    } catch (SiteverifyException $e) {
        // Could not reach siteverify. Fail closed (or queue the request for review).
        error_log('siteverify ' . $e->errorCode . ': ' . $e->getMessage());
        http_response_code(503);
        $message = 'Please try again in a moment.';
    }

    if (!str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'text/html')) {
        header('Content-Type: text/plain; charset=utf-8');
        echo $message, "\n";

        return;
    }
}

$h = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign up</title>
  <script src="/__waf/challenge/v1/widget.js" async defer></script>
</head>
<body>
  <?php if ($message !== null): ?><p><?= $h($message) ?></p><?php endif ?>
  <form method="post">
    <label>Email <input type="email" name="email" required></label>
    <div class="owaf-verify" data-sitekey="<?= $h($sitekey) ?>" data-action="signup"></div>
    <button type="submit">Sign up</button>
  </form>
</body>
</html>
