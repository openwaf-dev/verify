<?php

declare(strict_types=1);

// Router for `php -S`: a fake siteverify endpoint. The path selects the scenario.

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

function reply(int $status, string $body, array $headers = []): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    foreach ($headers as $h) {
        header($h);
    }
    echo $body;
}

function ok(array $extra = []): string
{
    return json_encode($extra + [
        'success' => true,
        'challenge_ts' => '2026-10-29T10:00:00Z',
        'hostname' => 'example.com',
        'action' => 'login',
        'error-codes' => [],
        'metadata' => ['mode' => 'managed', 'interactive' => false, 'risk' => 'low'],
    ]);
}

function fail(string ...$codes): string
{
    return json_encode(['success' => false, 'error-codes' => $codes]);
}

if (preg_match('#^/code/([a-z-]+)$#', $path, $m) === 1) {
    reply(200, fail($m[1]));

    return;
}

switch ($path) {
    case '/ok':
        reply(200, ok());
        break;
    case '/echo':
        reply(200, ok(['cdata' => json_encode([
            'method' => $_SERVER['REQUEST_METHOD'],
            'content_type' => $_SERVER['CONTENT_TYPE'] ?? '',
            'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
            'raw' => file_get_contents('php://input'),
            'post' => $_POST,
        ])]));
        break;
    case '/400':
        reply(400, fail('bad-request'));
        break;
    case '/405':
        reply(405, fail('bad-request'));
        break;
    case '/429':
        reply(429, fail('rate-limited'), ['Retry-After: 7']);
        break;
    case '/500':
        reply(500, fail('internal-error'));
        break;
    case '/502-html':
        http_response_code(502);
        header('Content-Type: text/html');
        echo '<html>bad gateway</html>';
        break;
    case '/nonjson':
        http_response_code(200);
        header('Content-Type: text/html');
        echo '<html>not json</html>';
        break;
    case '/no-codes':
        reply(200, json_encode(['success' => true]));
        break;
    case '/sleep':
        sleep(2);
        reply(200, ok());
        break;
    default:
        reply(404, '{}');
}
