// Copy-paste examples for signing an identity token on the business's server (docs/integrations.md §3).

export type SnippetLang = "node" | "python" | "php";

export const SIGN_SNIPPETS: { id: SnippetLang; label: string; install: string; code: string }[] = [
  {
    id: "node",
    label: "Node.js",
    install: "npm install jsonwebtoken",
    code: `import jwt from "jsonwebtoken";

// On your server only
const token = jwt.sign(
  {
    sub: String(user.id),
    name: user.name,
    email: user.email,
    attributes: { plan: "pro" },
  },
  process.env.HALOCHIME_IDENTITY_SECRET,
  { algorithm: "HS256", expiresIn: "1h" },
);`,
  },
  {
    id: "python",
    label: "Python",
    install: "pip install pyjwt",
    code: `import os, time
import jwt

# On your server only
now = int(time.time())
token = jwt.encode(
    {
        "sub": str(user.id),
        "name": user.name,
        "email": user.email,
        "attributes": {"plan": "pro"},
        "iat": now,
        "exp": now + 3600,
    },
    os.environ["HALOCHIME_IDENTITY_SECRET"],
    algorithm="HS256",
)`,
  },
  {
    id: "php",
    label: "PHP",
    install: "composer require firebase/php-jwt",
    code: `use Firebase\\JWT\\JWT;

// On your server only
$now = time();
$token = JWT::encode([
    'sub' => (string) $user->id,
    'name' => $user->name,
    'email' => $user->email,
    'attributes' => ['plan' => 'pro'],
    'iat' => $now,
    'exp' => $now + 3600,
], getenv('HALOCHIME_IDENTITY_SECRET'), 'HS256');`,
  },
];

export function widgetSnippets(scriptUrl: string, publicKey: string) {
  return {
    tag: `<script src="${scriptUrl}" data-key="${publicKey}"
  data-identity-token="TOKEN_FROM_YOUR_SERVER" async></script>`,
    js: `// After sign-in (works before or after widget.js loads)
window.Halochime = window.Halochime || { q: [] };
window.Halochime.q.push(["identify", { token }]);

// Once widget.js has loaded you can also call it directly:
Halochime.identify({ token });
Halochime.logout(); // on sign-out`,
  };
}
